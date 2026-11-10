// 02：時間を進めない描き直し（poke）。frame(t, 0) を count 回呼び、返事は advanced。
import { test, expect } from "@playwright/test";
import { openHarness, start, advance, statuses } from "./support/harness";

const entry = `let n = 0;
canvasApp.start((api) => ({
  frame(t, dt) {
    n++;
    api.ctx.fillStyle = "#123456"; api.ctx.fillRect(0, 0, api.width, api.height);
    api.ctx.fillStyle = "#ffcc00"; api.ctx.fillRect(40, 40, 60, 60);
    api.status({ n, dt });
  },
}));`;

/** シェルは status を毎秒 20 件までしか通さないので、件数ではなく最後の n で比べる。 */
const lastN = async (page: any) => {
  const s = await statuses(page);
  return s[s.length - 1].n as number;
};

test("poke は時間を進めずに frame を count 回呼ぶ", async ({ page }) => {
  await openHarness(page);
  await start(page, entry);
  await advance(page, 100);
  await page.waitForTimeout(1100); // status のレート窓を空ける
  const before = await lastN(page);
  const countBefore = (await statuses(page)).length;
  const r = await page.evaluate(() => (window as any).harness.poke(30));
  expect(r.type).toBe("advanced");
  // 30 件のうち毎秒 20 件を超えた分はシェルが落とすので、窓を空けてから 1 回だけ描き直し、その n で 30 回分を確かめる
  await page.waitForTimeout(1100);
  expect((await page.evaluate(() => (window as any).harness.poke(1))).type).toBe("advanced");
  await expect.poll(() => lastN(page)).toBe(before + 30 + 1);
  const added = (await statuses(page)).slice(countBefore);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every((v: any) => v.dt === 0)).toBe(true);
});
