// P1：3 つの表示モード。再マウントしない・状態を保つ・フォーカスが戻る・座標が合う。
import { test, expect, type Page } from "@playwright/test";
import { openHost, ask, waitCandidate, hostAdvance, preview, fallingState, settleInput } from "./support/host";
import { find, hex, deviceShot, shot } from "./support/pixels";

async function markFrame(page: Page) {
  await page.evaluate(() => { (window as any).__iframe = document.querySelector("#preview-frame iframe"); });
}
async function sameFrame(page: Page) {
  return page.evaluate(() => (window as any).__iframe === document.querySelector("#preview-frame iframe") && (window as any).__iframe.isConnected);
}
const readyCount = (page: Page) => page.evaluate(() => (window as any).__canvasHost.ctl.readyCount);

async function rowOf(page: Page) {
  const st = await fallingState(page);
  const cell = st.board.h / 20;
  return { row: Math.round((st.piece.box!.y - st.board.y) / cell), st };
}

test("ブラウザ全面へ切り替えても再起動せず、状態を保ち、Esc で戻ってフォーカスが戻る", async ({ page }) => {
  test.setTimeout(90_000);
  await openHost(page);
  const workers: string[] = [];
  await ask(page, "落ち物ゲームを作って");
  await waitCandidate(page);
  page.on("worker", (w) => workers.push(w.url()));
  await hostAdvance(page, 2400);
  const before = await rowOf(page);
  expect(before.row).toBe(3);
  await markFrame(page);
  const ready0 = await readyCount(page);

  const fillBtn = page.locator('[data-mode="fill"]');
  await fillBtn.click();
  await expect(page.locator("#preview-host")).toHaveClass(/mode-fill/);
  await hostAdvance(page, 0);
  const vp = page.viewportSize()!;
  const pb = (await preview(page).boundingBox())!;
  expect(pb.width).toBeGreaterThan(vp.width - 2);
  expect(pb.height).toBeGreaterThan(vp.height - 60);
  const during = await rowOf(page);
  expect(during.row).toBe(3); // 盤面は大きくなったが同じ段にいる
  expect(during.st.board.h).toBeGreaterThan(before.st.board.h);
  expect(await sameFrame(page)).toBe(true);
  expect(await readyCount(page)).toBe(ready0);
  expect(workers).toEqual([]);

  // 作品にフォーカスがある状態で Esc → 枠内に戻り、切り替えたボタンにフォーカスが戻る
  await preview(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await expect(page.locator("#preview-host")).toHaveClass(/mode-frame/);
  await expect(fillBtn).toBeFocused();
  await hostAdvance(page, 0);
  expect((await rowOf(page)).row).toBe(3);
  expect(await sameFrame(page)).toBe(true);
  expect(await readyCount(page)).toBe(ready0);

  // 会話の入力へ戻れる。入力欄でのキーは作品に渡らない
  const cx = (await fallingState(page)).piece.cx;
  await page.locator("#message").click();
  await page.keyboard.type("テスト");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#message")).toHaveValue("テスト");
  await hostAdvance(page, 0);
  expect((await fallingState(page)).piece.cx).toBe(cx);
});

test("全画面：対応していれば全画面化し、戻るボタンで元の表示とフォーカスに戻る。拒否時はブラウザ全面", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  await openHost(page);
  await ask(page, "落ち物ゲームを作って");
  await waitCandidate(page);
  await markFrame(page);
  const ready0 = await readyCount(page);
  const fsBtn = page.locator('[data-mode="fullscreen"]');
  await fsBtn.click();
  await expect(page.locator("#preview-host")).toHaveClass(/mode-(fullscreen|fill)/);
  const mode = (await page.locator("#preview-host").getAttribute("class"))!.includes("mode-fullscreen") ? "fullscreen" : "fill";
  const fsEl = await page.evaluate(() => document.fullscreenElement?.id ?? null);
  console.log(`[measure] ${browserName} fullscreen-request -> mode=${mode} fullscreenElement=${fsEl} notice=${await page.locator("#notice").textContent()}`);
  if (mode === "fullscreen") expect(fsEl).toBe("preview-host");
  else await expect(page.locator("#notice")).toContainText("ブラウザ全面");
  expect(await sameFrame(page)).toBe(true);
  await page.locator("#exit-mode").click();
  await expect(page.locator("#preview-host")).toHaveClass(/mode-frame/);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(fsBtn).toBeFocused();
  expect(await sameFrame(page)).toBe(true);
  expect(await readyCount(page)).toBe(ready0);
});

test.describe("全画面を拒否された場合", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = function () {
        return Promise.reject(new TypeError("denied"));
      };
    });
  });
  test("ブラウザ全面へ切り替わる", async ({ page }) => {
    test.setTimeout(90_000);
    await openHost(page);
    await ask(page, "落ち物ゲームを作って");
    await waitCandidate(page);
    await page.locator('[data-mode="fullscreen"]').click();
    await expect(page.locator("#preview-host")).toHaveClass(/mode-fill/);
    await expect(page.locator("#notice")).toContainText("拒否");
  });
});

test.describe("DPR 2", () => {
  test.use({ deviceScaleFactor: 2 });
  test("ブラウザ全面でもクリック位置と描画が一致する（可視化の凡例）", async ({ page }) => {
    test.setTimeout(90_000);
    await openHost(page);
    await ask(page, "合成データの売上を棒グラフにして、凡例のクリックで地域を絞り込めるようにして");
    await waitCandidate(page);
    await page.locator('[data-mode="fill"]').click();
    await expect(page.locator("#preview-host")).toHaveClass(/mode-fill/);
    await hostAdvance(page, 0);
    const blue = hex("#1f77b4");
    let s = await deviceShot(preview(page), 2);
    const region = { x: 0, y: 64, w: s.width / 2, h: s.height / 2 - 64 };
    expect(find(s, blue, 12, region).count).toBeGreaterThan(500);
    // 凡例「北」の色見本（12..26, 33..47）の中心をクリック
    const chip = find(s, blue, 12, { x: 0, y: 25, w: 60, h: 30 });
    expect(Math.abs(chip.cx - 19)).toBeLessThan(1.5);
    await preview(page).click({ position: { x: chip.cx, y: chip.cy } });
    await hostAdvance(page, 16);
    s = await deviceShot(preview(page), 2);
    expect(find(s, blue, 12, region).count).toBe(0);
  });
});

test("狭い表示では描画範囲と入力座標が同じ寸法で更新される", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 700, height: 700 });
  await openHost(page);
  await ask(page, "ブロック崩しを作って");
  await waitCandidate(page);
  const frame = preview(page);
  const box = (await frame.boundingBox())!;
  await frame.hover({ position: { x: 30, y: box.height - 60 } });
  await page.mouse.move(box.x + 50, box.y + box.height - 60, { steps: 2 });
  await settleInput(page);
  await hostAdvance(page, 16);
  const s = await shot(frame);
  const paddle = find(s, hex("#ffffff"), 10, { x: 0, y: box.height - 45, w: box.width, h: 25 });
  // パドル幅 80 の半分で端に止まる
  expect(Math.abs(paddle.cx - 50)).toBeLessThan(4);
  expect(s.width).toBeLessThan(400);
});
