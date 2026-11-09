import { test, expect } from "@playwright/test";
import { openHarness, start, advance, events } from "./support/harness";
import { shot, px, near, hex, find, deviceShot } from "./support/pixels";

const DRAW = `
canvasApp.start((api) => {
  let bg = "#000080", mark = null, frames = 0;
  return {
    frame(t) {
      frames++;
      const c = api.ctx;
      c.fillStyle = bg; c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = "#00ff00"; c.fillRect(Math.min(api.width - 20, t / 10), 10, 20, 20);
      if (mark) { c.fillStyle = "#ff0000"; c.fillRect(mark.x - 4, mark.y - 4, 8, 8); }
    },
    input(ev) {
      if (ev.type === "keydown" && ev.code === "Space") bg = "#808000";
      if (ev.type === "pointerdown") mark = { x: ev.x, y: ev.y };
    },
  };
});`;

test("作品が起動し、時刻・キー・ポインターで描画が変わる", async ({ page }) => {
  await openHarness(page);
  const r = await start(page, DRAW);
  expect(r.type).toBe("ready");
  const frame = page.locator("#frame");
  let s = await shot(frame);
  expect(near(px(s, 240, 200), hex("#000080"))).toBe(true);
  expect(find(s, hex("#00ff00")).cx).toBeLessThan(20);
  await advance(page, 1000);
  s = await shot(frame);
  const g = find(s, hex("#00ff00"));
  expect(g.cx).toBeGreaterThan(100);
  await frame.click({ position: { x: 300, y: 250 } });
  await page.keyboard.press("Space");
  await advance(page, 16);
  s = await shot(frame);
  expect(near(px(s, 50, 300), hex("#808000"))).toBe(true);
  const red = find(s, hex("#ff0000"));
  expect(Math.abs(red.cx - 300)).toBeLessThan(2);
  expect(Math.abs(red.cy - 250)).toBeLessThan(2);
  expect((await events(page)).filter((e) => e.type === "error")).toEqual([]);
});

test.describe("DPR 2", () => {
  test.use({ deviceScaleFactor: 2 });
  test("描画範囲と入力座標が同じ寸法で揃う", async ({ page }) => {
    await openHarness(page);
    expect((await start(page, DRAW)).type).toBe("ready");
    const frame = page.locator("#frame");
    await frame.click({ position: { x: 123, y: 77 } });
    await advance(page, 16);
    const s = await deviceShot(frame, 2);
    expect(s.width).toBe(960);
    const red = find(s, hex("#ff0000"));
    expect(Math.abs(red.cx - 123)).toBeLessThan(1.5);
    expect(Math.abs(red.cy - 77)).toBeLessThan(1.5);
    expect(red.box!.w).toBeGreaterThan(7);
    expect(red.box!.w).toBeLessThan(9);
  });
});

test("狭い表示へリサイズしても同じ実行が続き座標が合う", async ({ page }) => {
  await openHarness(page);
  expect((await start(page, DRAW)).type).toBe("ready");
  await page.evaluate(() => (window as any).harness.setNarrow(true));
  await advance(page, 16);
  const frame = page.locator("#frame");
  await frame.click({ position: { x: 200, y: 300 } });
  await advance(page, 16);
  const s = await shot(frame);
  expect(s.width).toBe(240);
  const red = find(s, hex("#ff0000"));
  expect(Math.abs(red.cx - 200)).toBeLessThan(2);
  expect(Math.abs(red.cy - 300)).toBeLessThan(2);
  const readyCount = await page.evaluate(() => (window as any).harness.readyCount());
  expect(readyCount).toBe(1);
});
