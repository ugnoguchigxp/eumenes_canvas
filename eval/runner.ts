// P2 評価の実行器（評価担当が凍結）。
//   bun eval/runner.ts --self-test          判定の対照（元作品・不具合入り元作品・空の作品）を確かめる
//   bun eval/runner.ts --run [--task ID]   記録済み推論で 3 回ずつ制作し、保存された作品を判定する
// 制作は製品と同じ CanvasService（契約検査・ホスト観測・修正 2 回まで・保存）を通す。判定は画素だけで行う。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { artworkDigest, type ArtworkBody } from "../src/contract/artwork";
import type { GenerationInput, GenerationOutput, ModelPort } from "../src/core/model-port";
import { PlaywrightObserver } from "../src/core/observer";
import { RecordedProvider } from "../src/core/recorded-provider";
import { CanvasService } from "../src/core/service";
import { Store } from "../src/core/store";
import type { Turn } from "../src/core/types";
import { startApp } from "../src/server/app";
import { CHECKS } from "./checks/heldout";
import { EvalEnv, type CheckResult } from "./lib/env";

const ROOT = resolve(import.meta.dir, "..");
const EVAL = import.meta.dir;
export const SAMPLES = 3;

interface Task {
  id: string;
  group: "new" | "modify" | "repair" | "nongame";
  seed: number;
  base?: string;
  baseTitle?: string;
  dataRef?: string;
  turns: string[];
}
const TASKS = (JSON.parse(readFileSync(join(EVAL, "tasks/heldout.json"), "utf8")) as { tasks: Task[] }).tasks;
const DATASETS = [{ ref: "synthetic-sensors", description: "合成センサー値（温度・湿度・気圧の 3 系列×25 点。groups[{name,color}], points[{group,x,y}]、x・y は 0〜100）", data: JSON.parse(readFileSync(join(EVAL, "data/synthetic-sensors.json"), "utf8")) }];
const dataFor = (ref?: string) => (ref ? (DATASETS.find((d) => d.ref === ref)?.data ?? null) : null);
const baseBody = (t: Task): ArtworkBody | null =>
  t.base ? { title: t.baseTitle!, entry: readFileSync(join(EVAL, t.base), "utf8"), ...(t.dataRef ? { dataRef: t.dataRef } : {}) } : null;

/** 元作品を版 1 として置くための前処理（評価の準備で、制作担当の推論には数えない）。 */
class SeedingModel implements ModelPort {
  readonly label: string;
  constructor(private inner: ModelPort, private seed: ArtworkBody | null) {
    this.label = inner.label;
  }
  generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput> {
    if (input.request === "[評価の準備] 元作品を版 1 にする" && this.seed)
      return Promise.resolve({ body: this.seed, changes: "元作品", unconfirmed: [], reply: "" });
    return this.inner.generate(input, signal);
  }
}

async function evaluate(env: EvalEnv, t: Task, body: ArtworkBody | null): Promise<CheckResult[]> {
  if (!body) return [{ id: "saved", kind: "start", pass: false, detail: "保存された作品がない" }];
  return CHECKS[t.id](env, body.entry, dataFor(body.dataRef), t.seed);
}

interface AttemptRecord {
  task: string;
  group: Task["group"];
  sample: number;
  pass: boolean;
  turns: { request: string; state: string; inferences: number; latencyMs: number; failure: string | null; observerFailures: string[] }[];
  inferences: number;
  finalDigest: string | null;
  checks: CheckResult[];
}

async function runAttempt(app: ReturnType<typeof startApp>, env: EvalEnv, t: Task, sample: number): Promise<AttemptRecord> {
  const provider = new RecordedProvider([join(EVAL, "recordings", `${t.id}.json`)], "recorded-eval");
  provider.sample = sample;
  provider.ignoreLatency = true;
  const contract = readFileSync(join(ROOT, "docs/artwork-contract-v1.md"), "utf8");
  const observer = new PlaywrightObserver(app.hostOrigin, (b) => app.tokens.issue(b));
  const svc = new CanvasService({ store: new Store(null), model: new SeedingModel(provider, baseBody(t)), observer, contract, datasets: DATASETS });
  const owner = "eval-owner", session = `eval-${t.id}-${sample}`;
  const rec: AttemptRecord = { task: t.id, group: t.group, sample, pass: false, turns: [], inferences: 0, finalDigest: null, checks: [] };
  let artworkId: string | null = null, revision = 0, n = 0;
  const key = () => `k${sample}_${t.id.replace(/[^A-Za-z0-9]/g, "")}_${n++}`;
  try {
    if (t.base) {
      const r = await svc.startRun(owner, session, { message: "[評価の準備] 元作品を版 1 にする" });
      await svc.drain();
      const st = svc.getRun(owner, r.id);
      if (st.state !== "presented") throw new Error("元作品が観測に通らない: " + st.failure);
      const s = await svc.save(owner, st.presentedCandidateId!, { expectedRevision: 0, idempotencyKey: key() });
      artworkId = (s.result as { artworkId: string }).artworkId;
      revision = 1;
    }
    const conversation: Turn[] = [];
    for (const turn of t.turns) {
      const t0 = performance.now();
      const r = await svc.startRun(owner, session, { message: turn, artworkId, conversation: [...conversation] });
      await svc.drain();
      const st = svc.getRun(owner, r.id);
      const latencyMs = Math.round(performance.now() - t0);
      rec.inferences += st.attempts;
      rec.turns.push({
        request: turn,
        state: st.state,
        inferences: st.attempts,
        latencyMs,
        failure: st.failure,
        observerFailures: st.candidates.flatMap((c) => (c.verification?.checks ?? []).filter((k) => !k.pass).map((k) => `${c.attempt}:${k.id}:${k.detail ?? ""}`.slice(0, 200))),
      });
      conversation.push({ role: "user", text: turn });
      if (st.state !== "presented") break;
      const cand = st.candidates.find((c) => c.id === st.presentedCandidateId)!;
      const s = await svc.save(owner, cand.id, { expectedRevision: revision, idempotencyKey: key() });
      artworkId = (s.result as { artworkId: string }).artworkId;
      revision = (s.result as { revision: number }).revision;
      conversation.push({ role: "assistant", text: cand.reply });
    }
    const allPresented = rec.turns.length === t.turns.length && rec.turns.every((x) => x.state === "presented");
    if (rec.inferences > 6) throw new Error("推論が 6 回を超えた");
    const body = allPresented && artworkId ? svc.resolvePreview(owner, { artworkId }).body : null;
    if (body) rec.finalDigest = await artworkDigest(body);
    rec.checks = allPresented ? await evaluate(env, t, body) : [{ id: "presented", kind: "start", pass: false, detail: "提示に至らない: " + rec.turns.at(-1)?.failure }];
    rec.pass = rec.checks.length > 0 && rec.checks.every((c) => c.pass);
  } finally {
    await svc.drain();
    await observer.close();
  }
  return rec;
}

// ---------- 対照 ----------
const BLANK = `canvasApp.start((api) => ({ frame() { api.ctx.fillStyle = "#000000"; api.ctx.fillRect(0, 0, api.width, api.height); } }));`;
interface Control {
  task: string;
  name: string;
  entry: string;
  data: unknown;
  /** all-pass: 全判定に合格する／change-fails: 変更の判定が 1 つ以上落ち、維持の判定はすべて通る／all-fail-start: 起動直後の判定がすべて落ちる */
  expect: "all-pass" | "change-fails" | "fails";
}
function controls(): Control[] {
  const out: Control[] = [];
  for (const t of TASKS) {
    const d = dataFor(t.dataRef);
    if (t.group === "new") out.push({ task: t.id, name: "空の作品", entry: BLANK, data: null, expect: "fails" });
    else out.push({ task: t.id, name: `元作品 ${t.base}`, entry: readFileSync(join(EVAL, t.base!), "utf8"), data: d, expect: "change-fails" });
    if (t.group === "repair") {
      const fixed = t.base!.replace(/-[a-z]+-bug\.js$/, ".js");
      out.push({ task: t.id, name: `不具合のない作品 ${fixed}`, entry: readFileSync(join(EVAL, fixed), "utf8"), data: d, expect: "all-pass" });
    }
  }
  return out;
}

function judgeControl(c: Control, r: CheckResult[]) {
  if (c.expect === "all-pass") return r.every((x) => x.pass);
  if (c.expect === "fails") return r.every((x) => !x.pass);
  return r.some((x) => x.kind === "change" && !x.pass) && r.filter((x) => x.kind !== "change").every((x) => x.pass);
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--task") ? args[args.indexOf("--task") + 1] : null;
  const app = startApp({ hostPort: 4320, previewPort: 4321, devHarness: true });
  const browser = await chromium.launch({ args: ["--mute-audio"] });
  const env = new EvalEnv(browser, app.hostOrigin);
  const outDir = join(EVAL, "out");
  mkdirSync(outDir, { recursive: true });
  let failed = 0;
  try {
    if (args.includes("--self-test")) {
      const rows = [];
      for (const c of controls()) {
        if (only && c.task !== only) continue;
        const t = TASKS.find((x) => x.id === c.task)!;
        const r = await CHECKS[t.id](env, c.entry, c.data, t.seed);
        const ok = judgeControl(c, r);
        if (!ok) failed++;
        rows.push({ ...c, entry: undefined, ok, checks: r });
        console.log(`${ok ? "OK  " : "NG  "} ${c.task} ${c.name}（期待 ${c.expect}）`);
        for (const x of r) console.log(`      ${x.pass ? "○" : "×"} [${x.kind}] ${x.id} ${x.detail ?? ""}`);
      }
      writeFileSync(join(outDir, "self-test.json"), JSON.stringify({ environment: `chromium ${browser.version()}`, rows }, null, 2));
      console.log(failed ? `対照の不一致 ${failed} 件` : "対照はすべて期待どおり");
    } else if (args.includes("--run")) {
      const records: AttemptRecord[] = [];
      for (const t of TASKS) {
        if (only && t.id !== only) continue;
        for (let k = 0; k < SAMPLES; k++) {
          const r = await runAttempt(app, env, t, k);
          records.push(r);
          console.log(`${r.pass ? "合格" : "不合格"} ${t.id} #${k} 推論 ${r.inferences} 回 ${r.turns.map((x) => x.state + "/" + x.latencyMs + "ms").join(" → ")}`);
          for (const x of r.checks) if (!x.pass) console.log(`      × [${x.kind}] ${x.id} ${x.detail ?? ""}`);
        }
      }
      writeFileSync(join(outDir, only ? `run-${only}.json` : "run.json"), JSON.stringify({ environment: `chromium ${browser.version()}`, samples: SAMPLES, records }, null, 2));
    } else {
      console.log("使い方: bun eval/runner.ts --self-test | --run [--task ID]");
    }
  } finally {
    await browser.close();
    app.stop();
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.main) await main();
