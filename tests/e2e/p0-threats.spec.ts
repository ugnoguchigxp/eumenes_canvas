// P0 脅威試験。作品の自己申告に加え、カナリアの到達数・ホスト側の状態・Worker の数で独立に確認する。
import { test, expect, type Page } from "@playwright/test";
import { openHarness, start, advance, events, statuses, waitStatus, canaryHits, CANARY } from "./support/harness";
import { shot, diffRatio } from "./support/pixels";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function hitsFor(id: string, all: any[]) {
  return all.filter((h) => h.path.includes(id));
}

async function hostStillOperable(page: Page) {
  const before = Number(await page.locator("#probe-count").textContent());
  await page.locator("#probe-button").click({ timeout: 2000 });
  await expect(page.locator("#probe-count")).toHaveText(String(before + 1), { timeout: 2000 });
  await page.locator("#probe-input").fill("ok");
  await expect(page.locator("#probe-input")).toHaveValue("ok");
}

// 作品側で攻撃を試み、結果を status に載せる。
const probe = (body: string) => `
canvasApp.start((api) => {
  const r = {};
  const done = () => api.status({ probe: r });
  (async () => { ${body} })().then(done, (e) => { r.fatal = String(e); done(); });
  return { frame() { api.ctx.fillStyle = "#222"; api.ctx.fillRect(0, 0, api.width, api.height); } };
});`;

test.describe("P0 隔離", () => {
  test("外部通信（fetch・XHR・WebSocket・EventSource）が届かない", async ({ page }) => {
    const id = uid();
    await openHarness(page);
    const r = await start(page, probe(`
      const u = "${CANARY}/net-${id}";
      try { await fetch(u + "/fetch"); r.fetch = "reached"; } catch (e) { r.fetch = "blocked:" + e.name; }
      try { await fetch(u + "/nocors", { mode: "no-cors" }); r.nocors = "reached"; } catch (e) { r.nocors = "blocked:" + e.name; }
      await new Promise((res) => { try { const x = new XMLHttpRequest(); x.open("GET", u + "/xhr"); x.onload = () => { r.xhr = "reached"; res(); }; x.onerror = () => { r.xhr = "blocked"; res(); }; x.send(); } catch (e) { r.xhr = "threw:" + e.name; res(); } });
      await new Promise((res) => { try { const w = new WebSocket("${CANARY.replace("http", "ws")}/ws-${id}"); w.onopen = () => { r.ws = "reached"; res(); }; w.onerror = () => { r.ws = "blocked"; res(); }; } catch (e) { r.ws = "threw:" + e.name; res(); } setTimeout(res, 1500); });
      await new Promise((res) => { try { const s = new EventSource(u + "/sse"); s.onopen = () => { r.sse = "reached"; res(); }; s.onerror = () => { r.sse = "blocked"; s.close(); res(); }; } catch (e) { r.sse = "threw:" + e.name; res(); } setTimeout(res, 1500); });
      r.sendBeacon = typeof navigator.sendBeacon;
    `));
    expect(r.type).toBe("ready");
    const s = await waitStatus(page, (v) => v.probe, 8000);
    expect(s).not.toBeNull();
    for (const k of ["fetch", "nocors", "xhr", "ws", "sse"]) expect(String(s.probe[k])).not.toBe("reached");
    await page.waitForTimeout(300);
    expect(hitsFor(id, await canaryHits())).toEqual([]);
  });

  test("外部コード読込（importScripts・動的 import・外部 URL の Worker）が届かない", async ({ page }) => {
    const id = uid();
    await openHarness(page);
    const r = await start(page, probe(`
      const u = "${CANARY}/code-${id}";
      try { self["import" + "Scripts"](u + "/is.js"); r.iscripts = "reached"; } catch (e) { r.iscripts = "blocked:" + e.name; }
      try { await import/**/(u + "/dyn.js"); r.dynImport = "reached"; } catch (e) { r.dynImport = "blocked:" + e.name; }
      try { r.eval = String((0, eval)("1+1")); } catch (e) { r.eval = "blocked:" + e.name; }
      try { r.fn = String(new Function("return 2")()); } catch (e) { r.fn = "blocked:" + e.name; }
    `));
    expect(r.type, JSON.stringify(r)).toBe("ready");
    const s = await waitStatus(page, (v) => v.probe, 8000);
    expect(s.probe.iscripts).toMatch(/^blocked/);
    expect(s.probe.dynImport).toMatch(/^blocked/);
    expect(s.probe.eval).toMatch(/^blocked/);
    expect(s.probe.fn).toMatch(/^blocked/);
    await page.waitForTimeout(300);
    expect(hitsFor(id, await canaryHits())).toEqual([]);
  });

  test("静的検査は import 宣言を拒否する（境界は CSP 側、静的検査は補助）", async ({ page }) => {
    await openHarness(page);
    const r = await start(page, `import x from "${CANARY}/a.js";\ncanvasApp.start(() => ({}));`);
    expect(r.type).toBe("rejected");
  });

  test("親画面の DOM・保存データ・cookie に触れられない", async ({ page, context }) => {
    await openHarness(page);
    await page.evaluate(() => {
      localStorage.setItem("host-secret", "s3cret");
      document.cookie = "hostcookie=abc; SameSite=Strict";
    });
    const titleBefore = await page.title();
    const r = await start(page, probe(`
      r.document = typeof document; r.parent = typeof parent; r.top = typeof top; r.opener = typeof opener;
      r.localStorage = typeof localStorage; r.sessionStorage = typeof sessionStorage;
      r.indexedDB = typeof indexedDB; r.caches = typeof caches; r.broadcast = typeof BroadcastChannel;
      r.cookieStore = typeof self.cookieStore; r.storage = typeof navigator.storage; r.locks = typeof navigator.locks;
      r.open = typeof self.open; r.locationAssign = typeof (self.location && self.location.assign);
      try { self.location.href = "${CANARY}/nav"; r.navSet = "no-throw"; } catch (e) { r.navSet = "threw:" + e.name; }
      try { const p = Object.getPrototypeOf(self); r.protoIdb = typeof Object.getOwnPropertyDescriptor(p, "indexedDB"); } catch (e) { r.protoIdb = "threw"; }
    `));
    expect(r.type).toBe("ready");
    const s = (await waitStatus(page, (v) => v.probe, 8000)).probe;
    for (const k of ["document", "parent", "top", "opener", "localStorage", "sessionStorage", "indexedDB", "caches", "broadcast", "cookieStore", "storage", "locks", "open", "locationAssign"])
      expect(s[k], k).toBe("undefined");
    expect(await page.evaluate(() => localStorage.getItem("host-secret"))).toBe("s3cret");
    expect(await page.title()).toBe(titleBefore);
    expect(page.url()).toContain("/harness.html");
    const cookies = await context.cookies("http://localhost:4310");
    expect(cookies.find((c) => c.name === "hostcookie")?.value).toBe("abc");
  });

  test("遷移・ポップアップが起きない", async ({ page }) => {
    const id = uid();
    await openHarness(page);
    let popups = 0;
    page.on("popup", () => popups++);
    const r = await start(page, probe(`
      try { self.open("${CANARY}/pop-${id}"); r.open = "called"; } catch (e) { r.open = "threw:" + e.name; }
      try { self.postMessage({ type: "navigate", url: "${CANARY}/nav-${id}" }); r.forged = "sent"; } catch (e) { r.forged = "threw"; }
    `));
    expect(r.type).toBe("ready");
    await waitStatus(page, (v) => v.probe, 8000);
    // シェル文書が遷移しようとした場合も sandbox で止まることを、固定シェルを模した直接操作で確認する
    const pf = page.frames().find((f) => f.url().includes("/shell.html"))!;
    const tryTop = await pf.evaluate((u) => { try { (top as any).location.href = u; return "no-throw"; } catch (e: any) { return "threw:" + e.name; } }, `${CANARY}/top-${id}`);
    const tryOpen = await pf.evaluate((u) => { try { return window.open(u) === null ? "null" : "opened"; } catch (e: any) { return "threw:" + e.name; } }, `${CANARY}/pop2-${id}`);
    await page.waitForTimeout(500);
    expect(page.url()).toContain("/harness.html");
    expect(popups).toBe(0);
    expect(tryOpen).not.toBe("opened");
    expect(tryTop).toMatch(/threw|no-throw/);
    expect(hitsFor(id, await canaryHits())).toEqual([]);
  });

  test("作品から子 Worker を起動できない", async ({ page }) => {
    await openHarness(page);
    const workers: string[] = [];
    page.on("worker", (w) => workers.push(w.url()));
    const r = await start(page, probe(`
      const tryW = (make) => new Promise((res) => {
        let w; try { w = make(); } catch (e) { return res("threw:" + e.name); }
        const t = setTimeout(() => res("silent"), 1500);
        w.onmessage = () => { clearTimeout(t); res("ran"); };
        w.onerror = (e) => { clearTimeout(t); res("error"); };
      });
      r.blob = await tryW(() => new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" }))));
      r.data = await tryW(() => new Worker("data:text/javascript,postMessage(1)"));
      r.same = await tryW(() => new Worker("/w/abcdefghijklmnopqrstuvwx"));
      r.shared = typeof SharedWorker;
    `));
    expect(r.type).toBe("ready");
    const s = (await waitStatus(page, (v) => v.probe, 10000)).probe;
    expect(s.blob).not.toBe("ran");
    expect(s.data).not.toBe("ran");
    expect(s.same).not.toBe("ran");
    expect(s.shared).toBe("undefined");
    // Playwright が観測した Worker は作品の 1 つだけ
    expect(workers.filter((u) => !u.includes("/w/")).length).toBe(0);
    expect(workers.length).toBeLessThanOrEqual(1);
  });

  test("過大・偽造・大量のメッセージを破棄し、超過時は停止する", async ({ page }) => {
    await openHarness(page);
    const r = await start(page, `
canvasApp.start((api) => {
  let n = 0;
  return { frame(t) {
    n++;
    if (n === 2) {
      self.postMessage({ type: "status", value: "x".repeat(10000) });
      self.postMessage({ type: "ready", extra: 1 });
      self.postMessage({ type: "fullscreen" });
      self.postMessage({ type: "save", candidate: "evil" });
      self.postMessage({ type: "advanced", seq: 424242 });
      self.postMessage("plain string");
      api.status({ marker: "after-forged" });
    }
    if (n === 4) { for (let i = 0; i < 2000; i++) self.postMessage({ type: "status", value: i }); }
    api.ctx.fillStyle = "#333"; api.ctx.fillRect(0, 0, api.width, api.height);
  } };
});`);
    expect(r.type).toBe("ready");
    await advance(page, 16);
    await advance(page, 16);
    await page.evaluate(() => { (window as any).harness.advance(16); });
    await page.waitForTimeout(800);
    const ev = await events(page);
    expect(ev.some((e) => e.type === "status" && e.value?.marker === "after-forged")).toBe(true);
    expect(ev.filter((e) => e.type === "status" && typeof e.value === "string").length).toBe(0);
    expect(ev.filter((e) => e.type === "ready").length).toBe(1);
    expect(ev.filter((e) => !["ready", "status", "violation", "advanced", "error"].includes(e.type))).toEqual([]);
    expect(ev.filter((e) => e.type === "status").length).toBeLessThanOrEqual(25);
    expect(ev.some((e) => e.type === "violation" && e.message === "message-rate")).toBe(true);
    // 偽装した親向け window メッセージは無視される（ホストはポートだけを読む）
    const pf = page.frames().find((f) => f.url().includes("/shell.html"))!;
    await pf.evaluate(() => parent.postMessage({ type: "status", runId: "x", value: { forged: true } }, "*"));
    await page.waitForTimeout(200);
    expect((await events(page)).some((e) => e.value?.forged)).toBe(false);
    await hostStillOperable(page);
  });
});

test.describe("P0 停止", () => {
  test("定常描画中に停止すると描画が止まり Worker が終わる", async ({ page }) => {
    await openHarness(page);
    const closed: number[] = [];
    page.on("worker", (w) => w.on("close", () => closed.push(Date.now())));
    const r = await start(page, `canvasApp.start((api) => ({ frame(t) { api.ctx.fillStyle = "hsl(" + (t / 5 % 360) + ",80%,50%)"; api.ctx.fillRect(0, 0, api.width, api.height); } }));`, { clock: "raf" });
    expect(r.type).toBe("ready");
    const frame = page.locator("#frame");
    const a = await shot(frame);
    await page.waitForTimeout(400);
    const b = await shot(frame);
    expect(diffRatio(a, b)).toBeGreaterThan(0.5);
    const stop = await page.evaluate(() => (window as any).harness.stop());
    expect(stop.method).toBe("terminate");
    const c = await shot(frame);
    await page.waitForTimeout(400);
    const d = await shot(frame);
    expect(diffRatio(c, d)).toBe(0);
    await expect.poll(() => closed.length, { timeout: 2000 }).toBeGreaterThanOrEqual(1);
    await hostStillOperable(page);
  });

  test("起動時のループが実時間の上限でエラーになり、元の位置を返す", async ({ page }) => {
    await openHarness(page);
    const t0 = Date.now();
    const result = await start(page, "canvasApp.start(() => {\n  for (;;) {}\n});");
    expect(result.type).toBe("error");
    expect(result.message).toContain("ループが 750ms 以内に制御を返さなかった（作品の 2 行 3 列）");
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  for (const where of ["frame", "toplevel"] as const) {
    test(`無限ループ（${where}）中でも停止から 2 秒以内に終わり、ホストを操作でき、再起動できる`, async ({ page }) => {
      await openHarness(page);
      const closed: number[] = [];
      page.on("worker", (w) => w.on("close", () => closed.push(Date.now())));
      const entry =
        where === "frame"
          ? `canvasApp.start((api) => ({ frame(t) { api.ctx.fillStyle = "#050"; api.ctx.fillRect(0, 0, api.width, api.height); if (t > 100) { while (true) {} } } }));`
          : `while (true) {}\ncanvasApp.start(() => ({}));`;
      if (where === "frame") {
        expect((await start(page, entry, { clock: "raf" })).type).toBe("ready");
      } else {
        await page.evaluate((e) => { (window as any).__p = (window as any).harness.start({ entry: e, clock: "raf" }); }, entry);
      }
      await page.waitForTimeout(600);
      await hostStillOperable(page); // ループ中でもホストは応答する
      const t0 = Date.now();
      const stop = await page.evaluate(() => (window as any).harness.stop());
      await expect.poll(() => closed.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
      const elapsed = closed[0] - t0;
      console.log(`[measure] infinite-loop(${where}) stop method=${stop.method} hostMs=${Math.round(stop.ms)} workerCloseMs=${elapsed}`);
      await hostStillOperable(page);
      const again = await start(page, `canvasApp.start((api) => ({ frame() { api.ctx.fillStyle = "#00f"; api.ctx.fillRect(0, 0, api.width, api.height); } }));`);
      expect(again.type).toBe("ready");
      expect(elapsed).toBeLessThan(2000);
      expect(Date.now() - t0).toBeLessThan(2000);
    });
  }
});
