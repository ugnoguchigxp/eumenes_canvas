// 05：描画の制約を外す。3D の面（api.canvas3d）・直接描画・更新と描画の分離（update・draw）・ホイール・後処理のアドオン。
// WebGL を使う試験は render.spec.ts と同じく Chromium だけ。直接描画は Chromium 系だけで使う（WebKit は複写方式のまま）。
import { test, expect, type Page } from "@playwright/test";
import { openHarness, start, advance, statuses, waitStatus, events } from "./support/harness";
import { shot, find, hex, px, near } from "./support/pixels";

const THREE_ID = "three@0.187.0";
const frame = (page: Page) => page.locator("#frame");
const errorsOf = async (page: Page) => (await events(page)).filter((e) => e.type === "error" || e.type === "violation").map((e) => e.message);
const shellFrame = (page: Page) => page.frames().find((f) => f.url().includes("/shell.html"))!;
const WHITE = hex("#ffffff"), RED = hex("#ff0000");

// 3D の面に WebGL で全面を赤、2D の面は消してから左上に白 20×20（overlay が偽なら 2D には描かない）
const redWithWhite = (overlay = true) => `canvasApp.start((api) => {
  const c3 = api.canvas3d;
  const gl = c3.getContext("webgl");
  return {
    frame() {
      gl.viewport(0, 0, c3.width, c3.height);
      gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      ${overlay ? 'api.ctx.clearRect(0, 0, api.width, api.height); api.ctx.fillStyle = "#ffffff"; api.ctx.fillRect(0, 0, 20, 20);' : ""}
    },
  };
});`;

function expectRedWithWhite(s: Awaited<ReturnType<typeof shot>>) {
  expect(near(px(s, 5, 5), WHITE, 30)).toBe(true);
  expect(near(px(s, 15, 15), WHITE, 30)).toBe(true);
  expect(near(px(s, 30, 30), RED, 30)).toBe(true);
  expect(near(px(s, s.width - 5, s.height - 5), RED, 30)).toBe(true);
  expect(find(s, WHITE, 30).count).toBeGreaterThanOrEqual(380);
  expect(find(s, WHITE, 30).count).toBeLessThanOrEqual(420);
}

test("複写方式で 3D の面が写る", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebGL は Chromium だけで確かめる");
  await openHarness(page);
  expect((await start(page, redWithWhite())).type).toBe("ready");
  await advance(page, 100);
  expectRedWithWhite(await shot(frame(page)));
  expect(await errorsOf(page)).toEqual([]);
});

test("3D の面を写し忘れても単色にならない（3D の面がそのまま表示に出る）", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebGL は Chromium だけで確かめる");
  await openHarness(page);
  expect((await start(page, redWithWhite(false))).type).toBe("ready");
  await advance(page, 100);
  const s = await shot(frame(page));
  expect(find(s, RED, 30).count).toBe(s.width * s.height);
});

test("直接描画：画面の canvas が 2 枚になり、3D の面の上に 2D の面が重なる", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "直接描画は Chromium 系だけ");
  await openHarness(page);
  expect((await start(page, redWithWhite(), { clock: "raf", direct: true })).type).toBe("ready");
  expect(await shellFrame(page).evaluate(() => document.querySelectorAll("canvas").length)).toBe(2);
  await page.waitForTimeout(1000);
  expectRedWithWhite(await shot(frame(page)));
  expect(await errorsOf(page)).toEqual([]);
});

test("直接描画でも入力が届く", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "直接描画は Chromium 系だけ");
  const entry = `canvasApp.start((api) => {
  let on = false;
  return {
    input(ev) { if (ev.type === "pointerdown") on = !on; },
    frame() { api.ctx.fillStyle = on ? "#00ff00" : "#0000ff"; api.ctx.fillRect(0, 0, api.width, api.height); },
  };
});`;
  await openHarness(page);
  expect((await start(page, entry, { clock: "raf", direct: true })).type).toBe("ready");
  await page.waitForTimeout(300);
  expect(near(px(await shot(frame(page)), 100, 100), hex("#0000ff"), 30)).toBe(true);
  await frame(page).click({ position: { x: 100, y: 100 } });
  await expect.poll(async () => near(px(await shot(frame(page)), 100, 100), hex("#00ff00"), 30)).toBe(true);
});

test("update・draw：時間を 1000ms 進めると update が 63 回、draw が 1 回増える", async ({ page }) => {
  const entry = `canvasApp.start((api) => {
  let u = 0, d = 0;
  return {
    update(t, dt) { u++; },
    draw(t) { d++; api.ctx.fillStyle = "#222"; api.ctx.fillRect(0, 0, api.width, api.height); api.status({ u, d }); },
  };
});`;
  await openHarness(page);
  expect((await start(page, entry)).type).toBe("ready");
  const s0 = (await statuses(page)).at(-1);
  await advance(page, 1000);
  const s1 = (await statuses(page)).at(-1);
  expect(s1.u - s0.u).toBe(63);
  expect(s1.d - s0.d).toBe(1);
});

test("ホイール：deltaY が作品に届く", async ({ page }) => {
  const entry = `canvasApp.start((api) => ({
  input(ev) { if (ev.type === "wheel") api.status({ wheel: true, deltaY: ev.deltaY, x: ev.x, y: ev.y }); },
  frame() { api.ctx.fillStyle = "#222"; api.ctx.fillRect(0, 0, api.width, api.height); },
}));`;
  await openHarness(page);
  expect((await start(page, entry)).type).toBe("ready");
  const b = (await frame(page).boundingBox())!;
  await page.mouse.move(b.x + 100, b.y + 100);
  await page.mouse.wheel(0, 120);
  await advance(page, 0);
  expect(await waitStatus(page, (v) => v && v.wheel && v.deltaY > 0)).not.toBeNull();
});

test("後処理のアドオンが THREE に入っている", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebGL は Chromium だけで確かめる");
  const entry = `canvasApp.start((api) => { api.status({ c: typeof THREE.EffectComposer, b: typeof THREE.UnrealBloomPass }); return { frame() { api.ctx.fillStyle = "#123"; api.ctx.fillRect(0, 0, api.width, api.height); } }; });`;
  await openHarness(page);
  expect((await start(page, entry, { libraries: [THREE_ID] })).type).toBe("ready");
  expect(await waitStatus(page, (v) => v && v.c)).toEqual({ c: "function", b: "function" });
});

test("WebKit は複写のまま表示に出る", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "WebKit だけ");
  const entry = `canvasApp.start((api) => ({ frame() { api.ctx.fillStyle = "#00ff00"; api.ctx.fillRect(0, 0, api.width, api.height); } }));`;
  await openHarness(page);
  expect((await start(page, entry, { clock: "raf" })).type).toBe("ready");
  expect(await shellFrame(page).evaluate(() => document.querySelectorAll("canvas").length)).toBe(1);
  await expect.poll(async () => near(px(await shot(frame(page)), 50, 50), hex("#00ff00"), 30)).toBe(true);
});
