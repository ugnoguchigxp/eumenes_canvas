// ホスト観測：宣言されたキー、描画領域のクリック、段階ごとの比較。
import { afterAll, expect, spyOn, test } from "bun:test";
import { chromium } from "@playwright/test";
import { ObservationBrowser } from "../../src/core/harness-session";
import { OBSERVER_SUITE, PAINTED_CLICKS, PlaywrightObserver, paintedTargets } from "../../src/core/observer";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { startApp } from "../../src/server/app";
import { runToEnd } from "./support";

function png(w: number, h: number, bg: [number, number, number], rects: { x: number; y: number; w: number; h: number; c: [number, number, number] }[]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...bg, 255], i * 4);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) data.set([...r.c, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}

test("paintedTargets：単色なら無し、描いた小領域は大きい順にその内側の点、画面の 1/4 を超える領域は除く", () => {
  expect(paintedTargets(png(480, 360, [0, 0, 0], []), 16)).toEqual([]);
  const rects = [
    { x: 400, y: 150, w: 60, h: 20, c: [255, 0, 0] as [number, number, number] },
    { x: 10, y: 10, w: 8, h: 8, c: [255, 255, 0] as [number, number, number] },
    { x: 0, y: 200, w: 480, h: 160, c: [0, 0, 255] as [number, number, number] },
  ];
  const t = paintedTargets(png(480, 360, [0, 0, 0], rects), 16);
  expect(t.length).toBe(2);
  expect(t[0].x >= 400 && t[0].x < 460 && t[0].y >= 150 && t[0].y < 170).toBe(true);
  expect(t[1].x >= 10 && t[1].x < 18 && t[1].y >= 10 && t[1].y < 18).toBe(true);
  const many = Array.from({ length: 40 }, (_, i) => ({ x: (i % 10) * 40 + 20, y: Math.floor(i / 10) * 40 + 20, w: 6, h: 6, c: [255, 255, 255] as [number, number, number] }));
  expect(paintedTargets(png(480, 360, [0, 0, 0], many), PAINTED_CLICKS).length).toBe(PAINTED_CLICKS);
});

// ---- 実ブラウザ（Chromium）での観測 ----
const app = startApp({ hostPort: 4460, previewPort: 4461, devHarness: true });
const observer = new PlaywrightObserver(app.hostOrigin, (b) => app.tokens.issue(b));
afterAll(async () => {
  await observer.close();
  app.stop();
});
const sig = () => new AbortController().signal;

test("観測用の Chromium にサーバーのモデルキーを渡さない", async () => {
  const key = "CANVAS_TEST_MODEL_KEY";
  const previous = process.env[key];
  process.env[key] = "synthetic-test-value";
  const launch = spyOn(chromium, "launch");
  const browser = new ObservationBrowser([]);
  try {
    expect((await browser.get()).isConnected()).toBe(true);
    const env = launch.mock.calls[0][0]?.env;
    expect(env).toBeDefined();
    expect(env?.[key]).toBeUndefined();
    expect(env?.HOME).toBe(process.env.HOME);
  } finally {
    launch.mockRestore();
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    await browser.close();
  }
}, 60_000);

// 固定点に当たらない小さなボタン（x 452〜472, y 160〜176）を押したときだけ色が変わる。時間では変わらない。
const OFF_GRID_TOGGLE = `canvasApp.start((api) => {
  let on = false;
  return {
    frame() {
      const c = api.ctx;
      c.fillStyle = "#101010"; c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = on ? "#00ff00" : "#ff0000"; c.fillRect(452, 160, 20, 16);
    },
    input(ev) {
      if (ev.type === "pointerdown" && ev.x >= 452 && ev.x < 472 && ev.y >= 160 && ev.y < 176) on = !on;
    },
  };
});`;
const STATIC = `canvasApp.start((api) => ({
  frame() {
    const c = api.ctx;
    c.fillStyle = "#000000"; c.fillRect(0, 0, api.width, api.height);
    c.fillStyle = "#ffffff"; c.fillRect(100, 100, 50, 30);
  },
}));`;

// 押している間だけ表示が変わり、離すと元に戻る（溜めて離す型）。一瞬の押下では観測にかからない。
const HOLD_ONLY = `canvasApp.start((api) => {
  let held = false;
  return {
    frame() {
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = "#808080"; c.fillRect(20, 300, 440, 4);
      if (held) { c.fillStyle = "#ffffff"; c.fillRect(20, 320, 100, 8); }
    },
    input(ev) {
      if (ev.code === "Space" || ev.key === " ") held = ev.type === "keydown";
    },
  };
});`;

test("取消済みの必須観測は起動しない", async () => {
  const reason = new Error("事前に取消");
  await expect(observer.observe({ title: "t", entry: HOLD_ONLY }, null, AbortSignal.abort(reason))).rejects.toBe(reason);
}, 60_000);

test("押している間だけ変わる作品も、キーを押し続ける段階で responds が合格する", async () => {
  const r = await observer.observe({ title: "t", entry: HOLD_ONLY }, null, sig());
  expect(r.checks.find((c) => c.id === "responds")?.pass).toBe(true);
}, 60_000);

test("suite は host-smoke/3", () => {
  expect(observer.suite).toBe(OBSERVER_SUITE);
  expect(OBSERVER_SUITE).toBe("host-smoke/3");
});

test("制作担当が宣言したキーを通常の候補提示で入力する", async () => {
  const body = { title: "モードと表示", entry: `canvasApp.start((api) => {
    let selected = false, sorted = false;
    return {
      frame() {
        const c = api.ctx;
        c.fillStyle = "#000000"; c.fillRect(0, 0, api.width, api.height);
        c.fillStyle = sorted ? "#00ff00" : "#ff0000"; c.fillRect(30, 40, 30, 60);
      },
      input(e) {
        if (e.type === "keyup" && e.code === "Digit7") selected = true;
        if (e.type === "keyup" && e.code === "KeyQ" && selected) sorted = true;
      },
    };
  });` };
  const withoutDeclaration = await observer.observe(body, null, sig());
  expect(withoutDeclaration.checks.find((c) => c.id === "responds")?.pass).toBe(false);
  const svc = new CanvasService({
    store: new Store(null), contract: "契約", observer,
    model: {
      label: "固定応答",
      async generate() {
        return { body, changes: "", unconfirmed: [], reply: "", spec: {
          requirements: ["7で選択してからQを離すと色が変わる"],
          controls: [
            { kind: "key", input: "F5", action: "無効な宣言", always: true },
            { kind: "key", input: "Digit7", action: "選択", always: true },
            { kind: "key", input: "KeyQ", action: "色を変える", always: false },
          ],
        } };
      },
    },
  });
  const run = await runToEnd(svc, "owner", "session", { message: "モードの表示を作って" });
  expect(run.state).toBe("presented");
  expect(run.candidates).toHaveLength(1);
  expect(run.candidates[0].spec?.controls.map((c) => c.input)).toEqual(["Digit7", "KeyQ"]);
  expect(run.candidates[0].verification?.checks.find((c) => c.id === "responds")?.pass).toBe(true);
}, 60_000);

test("固定点に当たらない描画領域のボタンでも、描画領域のクリックで responds が合格する", async () => {
  // ボタンは固定点（x=40+80i, y=45+90j）のどれにも当たらない
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) expect(40 + 80 * i >= 452 && 40 + 80 * i < 472 && 45 + 90 * j >= 160 && 45 + 90 * j < 176).toBe(false);
  const r = await observer.observe({ title: "t", entry: OFF_GRID_TOGGLE }, null, sig());
  expect(r.checks.find((c) => c.id === "responds")?.pass).toBe(true);
  expect(r.checks.every((c) => c.pass)).toBe(true);
}, 60_000);

test("静止した作品は responds が不合格。観測の文に経過時間・段階・差分・描画領域のクリック座標があり、固定点の座標は無い", async () => {
  const r = await observer.observe({ title: "t", entry: STATIC }, null, sig());
  expect(r.checks.find((c) => c.id === "responds")?.pass).toBe(false);
  const st = r.observations.find((o) => o.kind === "static")!;
  expect(st.message).toContain("2600ms");
  expect(st.message).toContain("押し続けている間と離した直後");
  expect(st.message).toContain("1000ms");
  expect(st.message).toContain("描画のある領域 1 点");
  expect(st.message).toMatch(/\((1[0-4]\d),(1[0-2]\d)\)/); // 白い四角の内側の点
  expect(st.message).not.toMatch(/\(40,45\)|\(120,/);
  expect(st.message).not.toContain("格子");
}, 60_000);

test("単色の作品は not-blank と responds が不合格（描画領域は無し）", async () => {
  const r = await observer.observe({ title: "t", entry: `canvasApp.start((api) => ({ frame() { api.ctx.fillStyle = "#400000"; api.ctx.fillRect(0, 0, api.width, api.height); } }));` }, null, sig());
  expect(r.checks.find((c) => c.id === "not-blank")?.pass).toBe(false);
  expect(r.checks.find((c) => c.id === "responds")?.pass).toBe(false);
  expect(r.observations.find((o) => o.kind === "blank")?.message).toContain("#400000");
  expect(r.observations.find((o) => o.kind === "static")?.message).toContain("描画のある領域 0 点");
}, 60_000);

test("実行時エラーは最初に出た段階を付けて返す", async () => {
  const r = await observer.observe({ title: "t", entry: `canvasApp.start((api) => ({ frame(t) { api.ctx.fillStyle = "#000"; api.ctx.fillRect(0,0,api.width,api.height); api.ctx.fillStyle = "#fff"; api.ctx.fillRect(t / 10, 10, 10, 10); }, input(ev) { if (ev.type === "keydown") throw new Error("boom"); } }));` }, null, sig());
  expect(r.checks.find((c) => c.id === "no-runtime-error")?.pass).toBe(false);
  expect(r.observations.find((o) => o.kind === "runtime-error")?.message).toContain("キー入力（起動から 1600ms）");
}, 60_000);
