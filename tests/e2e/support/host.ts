import { expect, type Page } from "@playwright/test";
import { shot, findWhere, saturated, find, hex } from "./pixels";

export async function openHost(page: Page) {
  await page.goto("/?clock=manual");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
}

export async function ask(page: Page, text: string) {
  await page.locator("#message").fill(text);
  await page.locator("#send").click();
}

export async function waitCandidate(page: Page) {
  await expect(page.locator("#save")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator("#preview-label")).toHaveText("候補", { timeout: 10_000 });
  await previewReady(page);
}

export async function previewReady(page: Page) {
  await expect(page.locator("#preview-host")).toHaveAttribute("data-ready", "1", { timeout: 10_000 });
}

export async function hostAdvance(page: Page, ms: number) {
  await settleInput(page);
  const r = await page.evaluate((m) => (window as any).__canvasHost.ctl.advance(m), ms);
  expect(r.type).toBe("advanced");
}

export const preview = (page: Page) => page.locator("#preview-frame");

/** 落ち物の盤面（黒）の外接矩形と、操作中ピース（彩度の高い画素）の位置。 */
export async function fallingState(page: Page) {
  const s = await shot(preview(page));
  const board = find(s, hex("#000000"), 4);
  const piece = findWhere(s, saturated, board.box ?? undefined);
  return { s, board: board.box!, piece };
}

export async function save(page: Page, rev: number) {
  await page.locator("#save").click();
  await expect(page.locator("#save-status")).toHaveText(`保存しました（r${rev}）`, { timeout: 10_000 });
}

/** 入力イベントがプレビューシェルに届くのを待つ（WebKit では mouse.move の完了が配送より先に返る）。 */
export async function settleInput(page: Page) {
  const pf = page.frames().find((f) => f.url().includes("/shell.html"));
  if (pf) await pf.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}
