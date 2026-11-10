// 03：性質の観測 host-probe/1 を実ブラウザ（Chromium）で動かす。observer.test.ts と同じ形。
import { afterAll, expect, test } from "bun:test";
import { PlaywrightProber, probeFindings, probeText } from "../../src/core/probes";
import type { MakerSpec } from "../../src/core/spec";
import { startApp } from "../../src/server/app";

const app = startApp({ hostPort: 4464, previewPort: 4465, devHarness: true });
const prober = new PlaywrightProber(app.hostOrigin, (b) => app.tokens.issue(b));
afterAll(async () => {
  await prober.close();
  app.stop();
});
const sig = () => new AbortController().signal;
const T = 60_000;
const SPEC: MakerSpec = { requirements: [{ id: "R1", text: "Space で跳ぶ" }], controls: [{ kind: "key", input: "Space", action: "ジャンプ", always: true }] };
const has = (fs: ReturnType<typeof probeFindings>, severity: string, id: string) => fs.some((f) => f.severity === severity && f.id === id);

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
const body = (entry: string) => ({ title: "probe", entry });

test("正しい作品", async () => {
  const r = await prober.probe(body(jumper(true)), null, SPEC, sig());
  expect(r.booted).toBe(true);
  expect(r.deterministic).toBe(true);
  expect(r.dtZero!.pixels).toBe(0);
  expect(r.inputs.find((i) => i.input === "Space")!.during.pixels).toBeGreaterThan(0);
  expect(probeFindings(r).filter((f) => f.severity === "blocking")).toEqual([]);
  console.log(`[prober] 正しい作品 ${r.ms}ms\n${probeText(r)}`);
}, T);

test("dt = 0 で進む作品", async () => {
  const r = await prober.probe(body(jumper(false)), null, SPEC, sig());
  const sp = r.inputs.find((i) => i.input === "Space")!;
  expect(sp.during.pixels).toBe(0);
  expect(sp.after.pixels).toBe(0);
  expect(has(probeFindings(r), "blocking", "P-input-Space")).toBe(true);
}, T);

test("dt = 0 で絵が動く作品", async () => {
  const entry = `canvasApp.start((api) => { let x = 0; return { frame() { x = (x + 1) % 400; const c = api.ctx; c.fillStyle = "#000"; c.fillRect(0, 0, api.width, api.height); c.fillStyle = "#fff"; c.fillRect(x, 100, 10, 10); } }; });`;
  const r = await prober.probe(body(entry), null, null, sig());
  expect(r.dtZero!.pixels).toBeGreaterThan(0);
  expect(has(probeFindings(r), "warning", "P-dt0")).toBe(true);
}, T);

test("再現性の無い作品", async () => {
  const entry = `canvasApp.start((api) => ({ frame() { const c = api.ctx; c.fillStyle = "#000"; c.fillRect(0, 0, api.width, api.height); c.fillStyle = "#f00"; c.fillRect(Math.random() * 400, Math.random() * 300, 20, 20); } }));`;
  const r = await prober.probe(body(entry), null, null, sig());
  expect(r.deterministic).toBe(false);
  expect(r.skipped).toContain("入力ごとの比較（再現性が無い）");
  expect(r.inputs).toEqual([]);
}, T);

test("キー入力で落ちる作品", async () => {
  const entry = `canvasApp.start((api) => ({ frame() { const c = api.ctx; c.fillStyle = "#000"; c.fillRect(0, 0, api.width, api.height); c.fillStyle = "#0f0"; c.fillRect(10, 10, 30, 30); }, input(ev) { if (ev.type === "keydown") throw new Error("input boom"); } }));`;
  const r = await prober.probe(body(entry), null, SPEC, sig());
  expect(has(probeFindings(r), "blocking", "P-input-Space")).toBe(true);
  expect(probeText(r)).toContain("実行時エラー");
}, T);

test("宣言なし", async () => {
  const r = await prober.probe(body(jumper(true)), null, null, sig());
  const keys = r.inputs.filter((i) => i.kind === "key");
  expect(keys.map((i) => i.input)).toEqual(["ArrowLeft", "ArrowRight", "ArrowUp", "Space"]);
  expect(keys.every((i) => !i.declared)).toBe(true);
}, T);

test("狭い幅で消える作品", async () => {
  const entry = `canvasApp.start((api) => ({ frame() { const c = api.ctx; c.fillStyle = "#000"; c.fillRect(0, 0, api.width, api.height); if (api.width >= 400) { c.fillStyle = "#0ff"; c.fillRect(20, 20, 100, 60); } } }));`;
  const r = await prober.probe(body(entry), null, null, sig());
  expect(r.resize!.narrowSingleColor).toBe(true);
  expect(has(probeFindings(r), "blocking", "P-resize")).toBe(true);
}, T);

test("版", () => {
  expect(prober.suite).toBe("host-probe/1");
});

test("台本の実行（07）", async () => {
  const plan = { scripts: [{ id: "S1", requirement: "R1", purpose: "跳ぶ", seed: 1, steps: [{ do: "shot", label: "前" }, { do: "tap", input: "Space", holdMs: 50 }, { do: "wait", ms: 150 }, { do: "track", color: "#00ff00", label: "跳躍中" }] }] } as const;
  const [r] = await prober.runScripts(body(jumper(true)), null, plan as any, sig());
  expect(r.skipped).toBeNull();
  expect(r.measures.length).toBe(2);
  const m = /#00ff00 の画素 \d+、左上\((\d+),(\d+)\)/.exec(r.measures[1].text);
  expect(m).not.toBeNull();
  expect(Number(m![2])).toBeLessThan(280); // 起動時は左上 y = 300 - 20 = 280
  console.log(`[prober] 台本\n${r.measures.map((x) => `${x.id}: [${x.t}ms ${x.label}] ${x.text}`).join("\n")}`);
}, T);
