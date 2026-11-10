// 01：実行時エラーの文に、作品の行と列（「（作品の N 行 M 列）」）が付く。
// WebKit のスタックの形で位置が取れない場合は位置なしでよい（取れたときは作品の 4 行目であること）。
import { test, expect } from "@playwright/test";
import { openHarness, start, advance, events } from "./support/harness";

const entry = `canvasApp.start((api) => ({
  frame(t, dt) {
    api.ctx.fillStyle = "#000"; api.ctx.fillRect(0, 0, api.width, api.height);
    if (t > 50) undefinedFunctionForTest();
  },
}));`;

test("実行時エラーに作品の行と列が付く", async ({ page, browserName }) => {
  await openHarness(page);
  await start(page, entry);
  await advance(page, 100);
  const msg = (await events(page)).find((e) => e.type === "error")?.message as string;
  expect(typeof msg).toBe("string");
  if (browserName === "chromium") {
    expect(msg).toMatch(/^frame: .*undefinedFunctionForTest.*（作品の 4 行 \d+ 列）$/);
  } else {
    expect(msg.startsWith("frame: ")).toBe(true);
    if (msg.includes("（作品の ")) expect(msg).toContain("（作品の 4 行 ");
    test.info().annotations.push({ type: "webkit-position", description: msg.includes("（作品の ") ? "位置あり" : "位置なし" });
    console.log(`[error-location] ${browserName}: ${msg}`);
  }
});
