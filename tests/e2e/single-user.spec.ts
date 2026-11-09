// 単一利用者モード（design.md §3）：どのブラウザでも、操作なしで dataDir の全作品が一覧に出る。
// 起動スクリプト（support/serve.ts）が通常の API でデモ 4 題を入れてある。
import { expect, test } from "@playwright/test";

const S = "http://localhost:4320";
const TITLES = ["テトリス", "オセロ", "インベーダーゲーム", "ソリティア"];

test("新しいブラウザ文脈でも、操作なしで 4 題が作品一覧に並ぶ（再読み込みで増えない）", async ({ browser, browserName }) => {
  const ctx = await browser.newContext(); // cookie も保存データも無い
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(S + "/");
  await expect(page.locator("#artworks li")).toHaveCount(4, { timeout: 10_000 });
  const ms = Date.now() - t0;
  test.info().annotations.push({ type: "list-ms", description: `${browserName}: ${ms}` });
  console.log(`[single-user] ${browserName}: 読み込み開始から 4 件表示まで ${ms} ms`);
  for (const t of TITLES) await expect(page.locator("#artworks li", { hasText: `${t}（r1）` })).toHaveCount(1);
  expect((await ctx.cookies()).filter((c) => c.name === "canvas_owner")).toEqual([]);

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
  await expect(page.locator("#artworks li")).toHaveCount(4);

  // 一覧から開くと保存版が動く
  await page.locator("#artworks button", { hasText: "オセロ" }).click();
  await expect(page.locator("#preview-host")).toHaveAttribute("data-ready", "1", { timeout: 15_000 });
  await expect(page.locator("#preview-label")).toHaveText("保存版 r1");
  await ctx.close();
});

test("ホスト以外のオリジンからの変更系要求は 403", async ({ request }) => {
  const r = await request.post(S + "/api/runs", { headers: { origin: "http://evil.example", "x-canvas-session": "session-e2e" }, data: { message: "テトリスを作って" } });
  expect(r.status()).toBe(403);
  const list = await (await request.get(S + "/api/artworks")).json();
  expect(list.length).toBe(4);
});
