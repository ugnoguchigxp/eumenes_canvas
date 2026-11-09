// P1：固定モデル応答で「作る→遊ぶ→直す→保存→再表示→復元」を画素の観測で通す。
import { test, expect } from "@playwright/test";
import { openHost, ask, waitCandidate, hostAdvance, preview, fallingState, save, previewReady } from "./support/host";
import { shot, find, hex, findWhere } from "./support/pixels";

/** 一定時間で操作中ピースが何セル落ちるか（セル寸法は盤面の高さ ÷ 20）。 */
async function fallCells(page: any, ms: number) {
  const a = await fallingState(page);
  await hostAdvance(page, ms);
  const b = await fallingState(page);
  const cell = a.board.h / 20;
  return { cells: Math.round((b.piece.box!.y - a.piece.box!.y) / cell), cell };
}

test("作る→遊ぶ→直す→保存→再表示→復元", async ({ page, context }) => {
  test.setTimeout(120_000);
  await openHost(page);
  await ask(page, "落ち物ゲームを作って");
  await waitCandidate(page);
  await expect(page.locator("#cand-checks")).toContainText("operated: responds 合格");

  // 遊ぶ：左移動と落下
  const st0 = await fallingState(page);
  expect(st0.piece.count).toBeGreaterThan(20);
  await preview(page).click({ position: { x: 5, y: 5 } });
  const before = (await fallingState(page)).piece.cx;
  await page.keyboard.press("ArrowLeft");
  await hostAdvance(page, 0);
  const after = (await fallingState(page)).piece.cx;
  expect(before - after).toBeGreaterThan(st0.board.h / 20 * 0.8);
  const base = await fallCells(page, 3200);
  expect(base.cells).toBe(4); // 800ms ごとに 1 段
  await save(page, 1);
  await expect(page.locator("#artworks")).toContainText("落ち物ゲーム（r1）");

  // 直す：落下の間隔を長くする。左右移動は保たれる
  await ask(page, "落下の間隔を長くして");
  await waitCandidate(page);
  const slow = await fallCells(page, 3200);
  expect(slow.cells).toBe(2);
  await preview(page).click({ position: { x: 5, y: 5 } });
  const b2 = (await fallingState(page)).piece.cx;
  await page.keyboard.press("ArrowRight");
  await hostAdvance(page, 0);
  expect((await fallingState(page)).piece.cx - b2).toBeGreaterThan(slow.cell * 0.8);
  await save(page, 2);

  // 再表示：別のタブで開き直すと保存した r2（遅い落下）が新規起動する
  const p2 = await context.newPage();
  await openHost(p2);
  await p2.locator("#artworks button", { hasText: "落ち物ゲーム（r2）" }).click();
  await expect(p2.locator("#preview-label")).toHaveText("保存版 r2");
  await previewReady(p2);
  expect((await fallCells(p2, 3200)).cells).toBe(2);

  // 復元：r1 を新しい版 r3 として復元すると、元の落下周期に戻る
  await p2.locator('#revisions li[data-revision="1"] button', { hasText: "この版を復元" }).click();
  await expect(p2.locator("#current")).toHaveText("落ち物ゲーム（現在 r3）");
  await expect(p2.locator('#revisions li[data-revision="3"]')).toContainText("r1 から復元");
  await expect(p2.locator("#preview-label")).toHaveText("保存版 r3");
  await previewReady(p2);
  expect((await fallCells(p2, 3200)).cells).toBe(4);
});

test("失敗した初回候補は観測を返して直し、直した候補を遊べる", async ({ page }) => {
  test.setTimeout(120_000);
  await openHost(page);
  await ask(page, "ブロック崩しを作って");
  await waitCandidate(page);
  await expect(page.locator("#run-status")).toHaveText("候補を提示（試行 2）");
  await expect(page.locator("#cand-changes")).toContainText("bal");
  const frame = preview(page);
  const box = (await frame.boundingBox())!;
  // パドル（白）がポインターに追従する
  // WebKit は枠に入った最初の移動で pointermove を出さないため、2 回に分けて動かす
  await frame.hover({ position: { x: 90, y: box.height - 60 } });
  await page.mouse.move(box.x + 100, box.y + box.height - 60, { steps: 2 });
  await hostAdvance(page, 16);
  let s = await shot(frame);
  const paddle = find(s, hex("#ffffff"), 10, { x: 0, y: box.height - 45, w: box.width, h: 25 });
  expect(Math.abs(paddle.cx - 100)).toBeLessThan(4);
  // 打ち出すとブロックが減る
  const bricks0 = find(s, hex("#ff4040"), 30).count + find(s, hex("#4080ff"), 30).count + find(s, hex("#40ff40"), 30).count + find(s, hex("#ffff40"), 30).count + find(s, hex("#ff9040"), 30).count;
  await frame.click({ position: { x: 100, y: box.height - 60 } });
  await hostAdvance(page, 2000);
  s = await shot(frame);
  const bricks1 = find(s, hex("#ff4040"), 30).count + find(s, hex("#4080ff"), 30).count + find(s, hex("#40ff40"), 30).count + find(s, hex("#ffff40"), 30).count + find(s, hex("#ff9040"), 30).count;
  expect(bricks1).toBeLessThan(bricks0);
});

test("非ゲーム：合成データの棒グラフを凡例で絞り込める", async ({ page }) => {
  test.setTimeout(120_000);
  await openHost(page);
  await ask(page, "合成データの売上を棒グラフにして、凡例のクリックで地域を絞り込めるようにして");
  await waitCandidate(page);
  const frame = preview(page);
  const blue = hex("#1f77b4");
  let s = await shot(frame);
  const chartRegion = { x: 0, y: 64, w: s.width, h: s.height - 64 };
  const n0 = find(s, blue, 12, chartRegion).count;
  expect(n0).toBeGreaterThan(200);
  const orange0 = find(s, hex("#ff7f0e"), 12, chartRegion).count;
  await frame.click({ position: { x: 20, y: 40 } }); // 凡例「北」
  await hostAdvance(page, 16);
  s = await shot(frame);
  expect(find(s, blue, 12, chartRegion).count).toBe(0);
  // 縦軸が残りの最大値に合わせて伸縮するため、他の系列は消えずに残る
  expect(find(s, hex("#ff7f0e"), 12, chartRegion).count).toBeGreaterThanOrEqual(orange0 * 0.9);
  await frame.click({ position: { x: 20, y: 40 } });
  await hostAdvance(page, 16);
  s = await shot(frame);
  expect(Math.abs(find(s, blue, 12, chartRegion).count - n0)).toBeLessThan(n0 * 0.02);
});

test("取消した依頼の結果は後から届いても表示・採用しない", async ({ page }) => {
  test.setTimeout(60_000);
  await openHost(page);
  await ask(page, "回避ゲームを作って");
  await expect(page.locator("#run-status")).toContainText("生成中");
  await page.locator("#cancel").click();
  await expect(page.locator("#run-status")).toHaveText("取り消しました");
  await page.waitForTimeout(4500);
  await expect(page.locator("#candidate")).toBeHidden();
  await expect(page.locator("#artworks li")).toHaveCount(0);
});

test("同時編集の競合：後から保存した候補は競合になり、候補は残る", async ({ page, context }) => {
  test.setTimeout(120_000);
  await openHost(page);
  await ask(page, "落ち物ゲームを作って");
  await waitCandidate(page);
  await save(page, 1);
  const other = await context.newPage(); // 別タブ＝別の制作画面
  await openHost(other);
  await other.locator("#artworks button", { hasText: "落ち物ゲーム（r1）" }).click();
  await expect(other.locator("#preview-label")).toHaveText("保存版 r1");
  // 両方の画面の会話は同じ前提（新規制作の 1 往復）にそろえる
  await other.evaluate(() => {
    const st = (window as any).__canvasHost.state;
    st.conversation = [{ role: "user", text: "落ち物ゲームを作って" }, { role: "assistant", text: "落ち物ゲームを作りました。" }];
  });
  await ask(page, "落下の間隔を長くして");
  await ask(other, "背景を紺色にして");
  await waitCandidate(page);
  await waitCandidate(other);
  await save(page, 2);
  await other.locator("#save").click();
  await expect(other.locator("#save-status")).toContainText("競合: 現在版は r2");
  await expect(other.locator("#save")).toBeEnabled();
  await expect(other.locator("#candidate")).toBeVisible();
  // 競合した候補は現在版を上書きしていない
  await other.reload();
  await expect(other.locator("body")).toHaveAttribute("data-ready", "1");
  await expect(other.locator("#artworks")).toContainText("落ち物ゲーム（r2）");
});

test("別の所有者には作品が見えず、API でも参照できない", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await openHost(page);
  await ask(page, "落ち物ゲームを作って");
  await waitCandidate(page);
  await save(page, 1);
  const id = await page.evaluate(() => (window as any).__canvasHost.state.artworkId);
  const ctx2 = await browser.newContext();
  const p = await ctx2.newPage();
  await openHost(p);
  await expect(p.locator("#artworks li")).toHaveCount(0);
  const r = await p.evaluate(async (aid) => (await fetch(`/api/artworks/${aid}`)).status, id);
  expect(r).toBe(404);
  const pv = await p.evaluate(async (aid) => (await fetch(`/api/previews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ artworkId: aid }) })).status, id);
  expect(pv).toBe(404);
  await ctx2.close();
});
