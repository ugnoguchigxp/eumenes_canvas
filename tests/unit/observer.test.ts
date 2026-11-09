// ホスト観測 host-smoke/2：描画領域のクリック、段階ごとの比較、観測の文（固定点の座標は書かない）。
import { afterAll, expect, test } from "bun:test";
import { OBSERVER_SUITE, PAINTED_CLICKS, PlaywrightObserver, paintedTargets } from "../../src/core/observer";
import { startApp } from "../../src/server/app";

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

test("押している間だけ変わる作品も、キーを押し続ける段階で responds が合格する", async () => {
  const r = await observer.observe({ title: "t", entry: HOLD_ONLY }, null, sig());
  expect(r.checks.find((c) => c.id === "responds")?.pass).toBe(true);
}, 60_000);

test("suite は host-smoke/2", () => {
  expect(observer.suite).toBe(OBSERVER_SUITE);
  expect(OBSERVER_SUITE).toBe("host-smoke/2");
});

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
