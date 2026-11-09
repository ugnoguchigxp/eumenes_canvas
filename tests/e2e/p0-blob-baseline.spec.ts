// 基準線：設計書 §4 の初期候補（allow-scripts のみの iframe ＋ Blob Worker）を測る。
// この方式では隔離の要件を満たせないことを記録する特性試験で、合格は「既知の結果が再現した」ことを意味する。
import { test, expect } from "@playwright/test";

test("Blob Worker 方式の基準線", async ({ page, browserName }) => {
  const msgs: string[] = [];
  page.on("console", (m) => msgs.push(m.text()));
  await page.goto("http://localhost:4313/");
  await page.waitForFunction(() => document.title.startsWith("R:"), null, { timeout: 4000 }).catch(() => {});
  const title = await page.title();
  if (browserName === "chromium") {
    // 親の CSP（worker-src blob:）を継承した Blob Worker から、さらに子 Worker を起動して実行できてしまう
    expect(title).toBe('R:{"child":"ran"}');
  } else {
    // WebKit では不透明オリジンの文書に 'self' が一致せず、固定シェル自体が読み込めない
    expect(title).toBe("");
    expect(msgs.some((m) => m.includes("script-src"))).toBe(true);
  }
});
