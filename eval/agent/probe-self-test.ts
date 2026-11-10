// 性質の観測 host-probe/1 の自己確認（評価担当、推論なし。docs/agent-plan/09-eval-and-models.md §3）。
//   bun eval/agent/probe-self-test.ts [--port 4790] [--out eval/out/probe-self-test.json]
// 正しいと分かっている作品に PlaywrightProber.probe を当て、重い指摘（blocking）が 1 件も出ないことを確かめる。
// 壊れた対照・dt = 0 の対照では、期待どおりに見つかることを確かめる。期待と違う作品が 1 件でもあれば終了コード 1。
// eval/gold/ はここ（評価側）からだけ読む。src/ には持ち込まない。warning は期待に入れない（件数を記録するだけ）。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { ArtworkBody } from "../../src/contract/artwork";
import { PlaywrightProber, probeFindings, PROBE_SUITE } from "../../src/core/probes";
import type { MakerSpec } from "../../src/core/spec";
import { startApp } from "../../src/server/app";
import { generalData } from "../general/suite";

const ROOT = resolve(import.meta.dir, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

type Expect = "no-blocking" | "finds-error" | "finds-input-Space";
interface Item {
  group: string;
  file: string;
  body: ArtworkBody;
  data: unknown;
  spec: MakerSpec | null;
  expect: Expect;
}

const SPACE_SPEC: MakerSpec = { requirements: [{ id: "R1", text: "Space で跳ぶ" }], controls: [{ kind: "key", input: "Space", action: "ジャンプ", always: true }] };
// tests/e2e/contract-dt0.spec.ts の jumper(guard) と同じ。guard が真なら dt > 0 のときだけ物理を進める
const jumper = (guard: boolean) => `canvasApp.start((api) => {
  const G = 1600, GROUND = 300;
  let y = GROUND, vy = 0;
  function update(s) {
    vy += G * s; y += vy * s;
    if (y >= GROUND) { y = GROUND; vy = 0; }
  }
  return {
    frame(t, dt) {
      ${guard ? "if (dt > 0) update(dt / 1000);" : "update(dt / 1000);"}
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = "#00ff00"; c.fillRect(60, y - 20, 20, 20);
    },
    input(ev) {
      if (ev.type === "keydown" && (ev.code === "Space" || ev.key === " ") && y >= GROUND) vy = -560;
    },
  };
});`;

function items(): Item[] {
  const out: Item[] = [];
  const sales = JSON.parse(read("fixtures/data/synthetic-sales.json"));
  for (const f of ["falling-block.js", "breakout.js", "viz-filter.js"])
    out.push({ group: "p1", file: `fixtures/p1/artworks/${f}`, body: { title: f, entry: read(`fixtures/p1/artworks/${f}`), ...(f === "viz-filter.js" ? { dataRef: "synthetic-sales" } : {}) }, data: f === "viz-filter.js" ? sales : null, spec: null, expect: "no-blocking" });
  for (const f of readdirSync(join(ROOT, "fixtures/demo/artworks")).filter((x) => x.endsWith(".js")).sort())
    out.push({ group: "demo", file: `fixtures/demo/artworks/${f}`, body: { title: f, entry: read(`fixtures/demo/artworks/${f}`) }, data: null, spec: null, expect: "no-blocking" });
  const tasks = JSON.parse(read("eval/tasks/general.json")).tasks as { id: string; dataRef?: string }[];
  for (const f of readdirSync(join(ROOT, "eval/gold/general")).filter((x) => x.endsWith(".js")).sort()) {
    const dataRef = tasks.find((t) => t.id === f.replace(/\.js$/, ""))?.dataRef ?? undefined;
    out.push({ group: "general-gold", file: `eval/gold/general/${f}`, body: { title: f, entry: read(`eval/gold/general/${f}`), ...(dataRef ? { dataRef } : {}) }, data: generalData(dataRef), spec: null, expect: "no-blocking" });
  }
  const demos = JSON.parse(read("examples/render/demos.json")).demos as { entry: string; title: string; libraries?: string[] }[];
  for (const d of demos)
    out.push({ group: "render-demo", file: `examples/render/${d.entry}`, body: { title: d.title, entry: read(`examples/render/${d.entry}`), ...(d.libraries?.length ? { libraries: d.libraries } : {}) }, data: null, spec: null, expect: "no-blocking" });
  out.push({ group: "broken", file: "fixtures/p1/artworks/breakout-broken.js", body: { title: "broken", entry: read("fixtures/p1/artworks/breakout-broken.js") }, data: null, spec: null, expect: "finds-error" });
  out.push({ group: "dt0", file: "jumper(false)", body: { title: "jumper(false)", entry: jumper(false) }, data: null, spec: SPACE_SPEC, expect: "finds-input-Space" });
  out.push({ group: "correct", file: "jumper(true)", body: { title: "jumper(true)", entry: jumper(true) }, data: null, spec: SPACE_SPEC, expect: "no-blocking" });
  return out;
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: "string" }, out: { type: "string" } } });
  const port = Number(values.port ?? 4790);
  const outFile = resolve(ROOT, values.out ?? "eval/out/probe-self-test.json");
  const t0 = performance.now();
  const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
  const prober = new PlaywrightProber(app.hostOrigin, (b) => app.tokens.issue(b));
  const results: Record<string, unknown>[] = [];
  let environment = "";
  try {
    for (const it of items()) {
      const r = await prober.probe(it.body, it.data, it.spec, new AbortController().signal);
      environment = r.environment;
      const fs = probeFindings(r);
      const blocking = fs.filter((f) => f.severity === "blocking");
      // 壊れた対照は、入力なしのエラー（P-errors）か、入力のあとのエラー（inputs[].errors）が出れば見つけたとする
      const ok =
        it.expect === "no-blocking"
          ? r.booted && blocking.length === 0
          : it.expect === "finds-error"
            ? !r.booted || fs.some((f) => f.id === "P-errors") || r.inputs.some((i) => i.errors.length > 0)
            : blocking.some((f) => f.id === "P-input-Space");
      results.push({
        group: it.group,
        file: it.file,
        expect: it.expect,
        booted: r.booted,
        findings: fs.map((f) => ({ severity: f.severity, id: f.id, message: f.message.slice(0, 300) })),
        warnings: fs.filter((f) => f.severity === "warning").length,
        deterministic: r.deterministic,
        dtZeroPixels: r.dtZero?.pixels ?? null,
        skipped: r.skipped,
        ms: r.ms,
        ok,
      });
      console.log(`${ok ? "期待どおり" : "期待と違う"} [${it.group}] ${it.file} ${fs.map((f) => `${f.severity}:${f.id}`).join(" ") || "指摘なし"}（${r.ms}ms${r.skipped.length ? "、省略 " + r.skipped.join("・") : ""}）`);
    }
  } finally {
    await prober.close();
    app.stop();
  }
  const groups: Record<string, { ok: number; n: number }> = {};
  for (const r of results) {
    const g = (groups[r.group as string] ??= { ok: 0, n: 0 });
    g.n++;
    if (r.ok) g.ok++;
  }
  const allOk = results.every((r) => r.ok);
  const summary = { suite: PROBE_SUITE, environment, checkedAt: new Date().toISOString(), totalMs: Math.round(performance.now() - t0), allOk, groups, results };
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify({ allOk, groups, totalMs: summary.totalMs }));
  process.exit(allOk ? 0 : 1);
}
if (import.meta.main) await main();
