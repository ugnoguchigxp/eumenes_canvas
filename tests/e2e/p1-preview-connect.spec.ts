// プレビューのオリジンに届かない（ブラウザが遮断する等）ときも、ホスト画面は操作でき、理由が見え、再接続できる。
import { test, expect } from "@playwright/test";
import { openHost, ask, previewReady } from "./support/host";

const PREVIEW = "http://127.0.0.1:4311";

test("プレビューに接続できないとき警告を出し、送信は動き、再接続で表示できる", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // プレビューのシェルだけを遮断する（ホストの API は通す）
  const block = (route: any) => route.abort("blockedbyclient");
  await page.route(`${PREVIEW}/shell.html`, block);

  await openHost(page); // 接続の成否を待たずに画面が使える
  await expect(page.locator("#preview-error")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("body")).toHaveAttribute("data-preview", "failed");
  const text = await page.locator("#preview-error-text").textContent();
  expect(text).toContain(`プレビュー（${PREVIEW}）に接続できません。5 秒以内に応答がありませんでした。`);
  expect(text).toContain("127.0.0.1 の埋め込みを遮断");
  expect(errors.some((e) => e.includes(`プレビュー（${PREVIEW}）に接続できません`))).toBe(true);

  // 送信は通り、候補の検査（サーバー側）と保存の可否まで進む
  await ask(page, "落ち物ゲームを作って");
  await expect(page.locator("#messages li.user")).toHaveText("落ち物ゲームを作って");
  await expect(page.locator("#save")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator("#preview-label")).toHaveText("候補");
  // 表示の起動で再接続を 1 回試み、それも時間切れになってから理由を出す
  await expect(page.locator("#notice")).toContainText("プレビューに接続できないため表示できません", { timeout: 15_000 });
  await expect(page.locator("#preview-host")).toHaveAttribute("data-ready", "0");

  // 遮断を外して再接続すると、最後に開こうとした候補が表示される
  await page.unroute(`${PREVIEW}/shell.html`, block);
  await page.locator("#preview-retry").click();
  await expect(page.locator("body")).toHaveAttribute("data-preview", "connected", { timeout: 15_000 });
  await expect(page.locator("#preview-error")).toBeHidden();
  await previewReady(page);
});

test("接続中も失敗後も、作品一覧・新規・表示モードの操作は効く", async ({ page }) => {
  await page.route(`${PREVIEW}/shell.html`, (route) => route.abort("blockedbyclient"));
  await openHost(page);
  await page.locator("#preview-host [data-mode=fill]").click();
  await expect(page.locator("#preview-host")).toHaveClass(/mode-fill/);
  await page.locator("#exit-mode").click();
  await expect(page.locator("#preview-host")).toHaveClass(/mode-frame/);
  await expect(page.locator("#preview-error")).toBeVisible({ timeout: 15_000 });
  await page.locator("#new-artwork").click();
  await expect(page.locator("#current")).toHaveText("新規の作品");
  await page.locator("#stop").click(); // 未接続でも例外で止まらない
  await expect(page.locator("#preview-error")).toBeVisible();
});
