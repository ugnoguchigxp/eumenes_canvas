// 基準線：設計書 §4 の初期候補（allow-scripts のみの iframe ＋ Blob Worker）を測る。
// この方式では隔離の要件を満たせないことを記録する特性試験で、合格は「既知の結果が再現した」ことを意味する。
import { test, expect } from "@playwright/test";

test("Blob Worker 方式の基準線", async ({ page }) => {
  await page.goto("http://localhost:4313/");
  await page.waitForFunction(() => document.title.startsWith("R:"), null, { timeout: 4000 });
  // Playwright 1.65.0 では Chromium と WebKit のどちらも、旧方式の子 Worker が実行された。
  expect(await page.title()).toBe('R:{"child":"ran"}');
});
