// 公開契約（docs/artwork-contract-v1.md）に書いた frame(t, 0) の動作を、共通プレビューで確かめる。
// 入力のたびに dt=0 で frame が呼ばれる。契約どおり dt>0 のときだけ物理を進める作品は跳べ、dt=0 でも物理を進める作品は跳べない。
import { test, expect } from "@playwright/test";
import { openHarness, start, advance, statuses, waitStatus } from "./support/harness";
import { shot, find, hex } from "./support/pixels";

const PROBE = `canvasApp.start((api) => {
  let pending = null, n = 0;
  return {
    frame(t, dt) {
      if (pending && dt === 0) { api.status({ zeroAfter: pending, t, n: ++n }); pending = null; }
      api.ctx.fillStyle = "#000000"; api.ctx.fillRect(0, 0, api.width, api.height);
    },
    input(ev) { if (ev.type !== "pointermove") pending = ev.type; },
  };
});`;

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

test("キー入力・クリックのたびに frame(t, 0) が呼ばれる", async ({ page }) => {
  await openHarness(page);
  expect((await start(page, PROBE)).type).toBe("ready");
  await advance(page, 100);
  await page.evaluate(() => (window as any).harness.focus());
  await page.keyboard.press("Space");
  expect(await waitStatus(page, (v) => v && v.zeroAfter === "keydown")).not.toBeNull();
  await page.locator("#frame").click({ position: { x: 100, y: 100 } });
  expect(await waitStatus(page, (v) => v && v.zeroAfter === "pointerdown")).not.toBeNull();
  expect((await statuses(page)).length).toBeGreaterThanOrEqual(2);
});

test("dt>0 のときだけ物理を進める作品は Space で跳び、dt=0 でも進める作品は跳べない", async ({ page }) => {
  const GREEN = hex("#00ff00");
  for (const [guard, jumps] of [[true, true], [false, false]] as const) {
    await openHarness(page);
    expect((await start(page, jumper(guard))).type).toBe("ready");
    await advance(page, 50);
    const frame = page.locator("#frame");
    const y0 = find(await shot(frame), GREEN).cy;
    await page.evaluate(() => (window as any).harness.focus());
    await page.keyboard.press("Space");
    await advance(page, 200);
    const y1 = find(await shot(frame), GREEN).cy;
    if (jumps) expect(y0 - y1).toBeGreaterThan(40);
    else expect(Math.abs(y0 - y1)).toBeLessThan(2);
  }
});
