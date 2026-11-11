// ページ直接モード（design.md §8、docs/artwork-contract-v2-page.md）。設定で有効にした検証ホスト（4325）で、
// 作品が DOM のある文書で動き、描き、時計・データ・入力・エラー・Esc・停止がホストに届くことと、通信が止まることを確かめる。
// 既定の検証ホスト（4310）では runtime を拒否する（従来と同じ）。
// ページ直接モードの作品は Chromium だけで開く（WebKit では作品の無限ループでホストごと固まる。ホストの画面は WebKit で開かない）。
import { test, expect, chromium, type Page } from "@playwright/test";
import { canaryHits, canaryReset, CANARY } from "./support/harness";
import { shot, px, near, hex } from "./support/pixels";

const PAGE_HOST = "http://localhost:4325";
const frame = (page: Page) => page.locator("#frame");
const RED = hex("#ff0000");

async function openPageHarness(page: Page, origin = PAGE_HOST) {
  await page.goto(origin + "/harness.html");
  await expect(page).toHaveTitle("ready");
}
const startPage = (page: Page, entry: string, o: { data?: unknown; clock?: "raf" | "manual"; libraries?: string[] } = {}) =>
  page.evaluate((a) => (window as any).harness.start(a), { entry, title: "page", data: o.data ?? null, seed: 1, clock: o.clock ?? "manual", runtime: "page", ...(o.libraries ? { libraries: o.libraries } : {}) });
const advance = (page: Page, ms: number) => page.evaluate((m) => (window as any).harness.advance(m), ms);
const evs = (page: Page): Promise<any[]> => page.evaluate(() => (window as any).harness.events.map((e: any) => ({ ...e })));
const statuses = async (page: Page) => (await evs(page)).filter((e) => e.type === "status").map((e) => e.value);

// 全面を赤で塗り、rAF の回数・データ・seed 固定の乱数・入力を status で知らせる
const RED_WORK = `
const stage = document.getElementById("stage");
const ctx = stage.getContext("2d");
let n = 0;
canvasHost.status({ boot: true, data: canvasHost.data, r: Math.random(), size: [stage.width, stage.height], dom: typeof document.createElement });
stage.addEventListener("pointerdown", (e) => canvasHost.status({ click: [Math.round(e.offsetX), Math.round(e.offsetY)] }));
addEventListener("keydown", (e) => canvasHost.status({ key: e.code }));
function f(t) { n++; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, stage.width, stage.height); if (n % 10 === 0) canvasHost.status({ frames: n, t }); requestAnimationFrame(f); }
requestAnimationFrame(f);
`;

test.describe("ページ直接モード（有効な検証ホスト）", () => {
  test.beforeEach(({ browserName }) => test.skip(browserName !== "chromium", "ページ直接モードは Chromium だけで開く（design.md §8）"));

  test("DOM のある文書で動き、描き、データ・seed・仮想の時計・入力・Esc がホストに届く", async ({ page }) => {
    await openPageHarness(page);
    const r = await startPage(page, RED_WORK, { data: { a: 1 } });
    expect(r.type).toBe("ready");
    const boot = (await statuses(page)).find((s) => s.boot);
    expect(boot.data).toEqual({ a: 1 });
    expect(boot.dom).toBe("function");
    expect(boot.size[0]).toBeGreaterThan(100);
    // 同じ seed なら同じ乱数（もう一度起動して比べる）
    const s = await shot(frame(page));
    expect(near(px(s, 10, 10), RED, 30)).toBe(true);
    expect(near(px(s, s.width - 10, s.height - 10), RED, 30)).toBe(true);
    // 仮想の時計：1000ms 進めると rAF は 16ms ごとに約 62 回（起動時の 1 回を足す）
    await advance(page, 1000);
    const fr = (await statuses(page)).filter((x) => x.frames).pop();
    expect(fr.frames).toBe(60);
    expect(fr.t).toBe(944); // n 回目の rAF は (n - 1) × 16ms

    // 入力は作品の文書に直接届く
    await frame(page).click({ position: { x: 50, y: 40 } });
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await statuses(page)).some((x) => x.key === "ArrowLeft")).toBe(true);
    const click = (await statuses(page)).find((x) => x.click);
    expect(click.click).toEqual([50, 40]);
    // Esc は作品へではなくホストへ
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await evs(page)).some((e) => e.type === "escape")).toBe(true);
    expect((await statuses(page)).some((x) => x.key === "Escape")).toBe(false); // 作品には渡さない
    const r1 = boot.r;
    expect((await startPage(page, RED_WORK)).type).toBe("ready");
    expect((await statuses(page)).filter((x) => x.boot).pop().r).toBe(r1);
    const st = await page.evaluate(() => (window as any).harness.stop());
    expect(st.method).toBe("terminate");
  });

  test("ライブラリ（Three.js）は大域の THREE として使える", async ({ page }) => {
    await openPageHarness(page);
    const entry = `
const stage = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas: stage });
renderer.setSize(stage.width, stage.height, false);
renderer.setClearColor(0xff0000, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, stage.width / stage.height, 0.1, 10);
requestAnimationFrame(function f() { renderer.render(scene, camera); requestAnimationFrame(f); });
canvasHost.status({ rev: THREE.REVISION });`;
    expect((await startPage(page, entry, { libraries: ["three@0.187.0"] })).type).toBe("ready");
    await advance(page, 100);
    expect((await statuses(page)).find((s) => s.rev)?.rev).toBe("187");
    const s = await shot(frame(page));
    expect(near(px(s, 20, 20), RED, 30)).toBe(true);
  });

  test("起動時（本文と最初の rAF）の例外は error で終わり、実行中の例外も error として届く", async ({ page }) => {
    await openPageHarness(page);
    const r = await startPage(page, `throw new Error("boom-at-start");`);
    expect(r.type).toBe("error");
    expect(r.message).toContain("boom-at-start");
    expect((await startPage(page, `let k = 0; requestAnimationFrame(function f() { requestAnimationFrame(f); if (++k === 3) throw new Error("boom-in-frame"); });`)).type).toBe("ready");
    await advance(page, 50);
    await expect.poll(async () => (await evs(page)).filter((e) => e.type === "error").map((e) => e.message).join(" ")).toContain("boom-in-frame");
  });

  test("通信（fetch・WebSocket・画像・入れ子の iframe・Worker）は止まり、カナリアに届かない", async ({ page }) => {
    await openPageHarness(page);
    await canaryReset();
    const entry = `
const out = {};
const tryIt = async (k, f) => { try { await f(); out[k] = "ok"; } catch (e) { out[k] = "blocked"; } };
(async () => {
  await tryIt("fetch", () => fetch("${CANARY}/page-fetch"));
  await tryIt("ws", () => new Promise((res, rej) => { const w = new WebSocket("${CANARY.replace("http", "ws")}/page-ws"); w.onopen = res; w.onerror = rej; }));
  await tryIt("img", () => new Promise((res, rej) => { const i = new Image(); i.onload = res; i.onerror = rej; i.src = "${CANARY}/page-img"; }));
  await tryIt("worker", () => new Promise((res, rej) => { const w = new Worker("data:text/javascript,postMessage(1)"); w.onmessage = res; w.onerror = rej; setTimeout(rej, 2000); }));
  const f = document.createElement("iframe"); f.src = "${CANARY}/page-iframe"; document.body.appendChild(f);
  try { parent.location.href = "${CANARY}/page-nav"; } catch {}
  canvasHost.status({ net: out });
})();`;
    expect((await startPage(page, entry, { clock: "raf" })).type).toBe("ready");
    await expect.poll(async () => (await statuses(page)).find((s) => s.net)?.net, { timeout: 8000 }).toBeTruthy();
    const net = (await statuses(page)).find((s) => s.net).net;
    expect(net.fetch).toBe("blocked");
    expect(net.ws).toBe("blocked");
    expect(net.img).toBe("blocked");
    expect(net.worker).toBe("blocked");
    await page.waitForTimeout(500);
    expect((await canaryHits()).filter((h: any) => String(h.path).startsWith("/page-"))).toEqual([]);
    // ホストの画面は元のまま
    expect(new URL(page.url()).origin).toBe(PAGE_HOST);
  });

  test("無限ループの作品も、サイトごとのプロセス分離のある Chromium では 2 秒以内に止まり、ホストは操作でき、次の作品を起動できる", async () => {
    // plan.md §4 のページ直接モードの条件は「サイトごとのプロセス分離のある Chromium」（実際のデスクトップの Chrome の既定）。
    // Playwright の既定の headless shell は分離が無く、ホストごと固まる（10 の測定 H1・H2）ので、--site-per-process で起動する
    const browser = await chromium.launch({ args: ["--site-per-process"] });
    const page = await (await browser.newContext({ viewport: { width: 1000, height: 760 } })).newPage();
    try {
    await openPageHarness(page);
    expect((await startPage(page, `setTimeout(() => { for (;;) {} }, 50); canvasHost.status("armed");`, { clock: "raf" })).type).toBe("ready");
    await page.waitForTimeout(300);
    const t0 = Date.now();
    const st = await page.evaluate(() => (window as any).harness.stop());
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(["terminate", "reload"]).toContain(st.method);
    await page.locator("#probe-button").click();
    await expect(page.locator("#probe-count")).toHaveText("1");
    expect((await startPage(page, RED_WORK)).type).toBe("ready");
    } finally {
      await browser.close();
    }
  });

  test("作品の文書から窓へ送ったメッセージ・偽の通知はホストの状態を変えない", async ({ page }) => {
    await openPageHarness(page);
    const entry = `
for (const w of [parent, top]) { try { w.postMessage({ type: "ready", runId: "x" }, "*"); w.postMessage({ type: "canvas-connect" }, "*"); } catch {} }
canvasHost.status({ forged: true });`;
    expect((await startPage(page, entry)).type).toBe("ready");
    await advance(page, 50);
    expect(await page.evaluate(() => (window as any).harness.readyCount())).toBe(1);
  });
});

test("既定の検証ホストではページ直接モードの作品を拒否する（従来と同じ）", async ({ page }) => {
  await openPageHarness(page, "http://localhost:4310");
  const r = await startPage(page, RED_WORK);
  expect(r.type).toBe("rejected");
  expect(r.errors.join(" ")).toContain("未定義の項目");
});

test("制作の流れ：ページ直接モードの作品は観測（--site-per-process の Chromium）に通り、プレビューで開くたびに警告が出る", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebKit での拒否は次の試験で確かめる");
  test.setTimeout(120_000);
  await page.goto(PAGE_HOST + "/?clock=manual");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
  await expect(page.locator("#page-warning")).toBeHidden();
  await page.locator("#message").fill("ページ直接モードで跳ねる四角を作って");
  await page.locator("#send").click();
  await expect(page.locator("#save")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator("#cand-checks")).toContainText("contract: contract 合格");
  await expect(page.locator("#cand-checks")).toContainText("operated: responds 合格");
  await expect(page.locator("#preview-host")).toHaveAttribute("data-ready", "1", { timeout: 10_000 });
  await expect(page.locator("#page-warning")).toBeVisible();
  await expect(page.locator("#page-warning")).toContainText("WebRTC");
  // 描いている（背景の色がある）
  const s = await shot(page.locator("#preview-frame"));
  expect(near(px(s, s.width - 3, s.height - 3), hex("#101820"), 12)).toBe(true);
  // 保存して保存版を開き直しても、開くたびに警告が出る
  await page.locator("#save").click();
  await expect(page.locator("#save-status")).toHaveText("保存しました（r1）", { timeout: 10_000 });
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
  await page.locator("#artworks button", { hasText: "跳ねる四角（ページ直接モード）（r1）" }).click();
  await expect(page.locator("#preview-host")).toHaveAttribute("data-ready", "1", { timeout: 10_000 });
  await expect(page.locator("#page-warning")).toBeVisible();
});

test("WebKit のホストの画面はページ直接モードの作品を開かず、理由を出す", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "WebKit だけの試験");
  test.setTimeout(120_000);
  await page.goto(PAGE_HOST + "/?clock=manual");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
  await page.locator("#message").fill("ページ直接モードで跳ねる四角を作って");
  await page.locator("#send").click();
  // 候補は観測（サーバー側の Chromium）に通るが、WebKit の画面では開かない
  await expect(page.locator("#save")).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator("#page-warning")).toBeVisible();
  await expect(page.locator("#page-warning")).toContainText("Safari（WebKit）では開きません");
  await expect(page.locator("#preview-host")).toHaveAttribute("data-ready", "0");
  expect(page.frames().some((f) => f.url().includes("/p/"))).toBe(false);
});
