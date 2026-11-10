// 10：ページ直接モード（作品を DOM のある文書のメインスレッドで動かす方式）の境界の実測（docs/agent-plan/10-page-mode.md §3）。
// 配信は試験用の待ち受けだけ（tests/e2e/support/page-boundary.ts）。製品コードは変えない。
// 止まるべき項目（C1〜C3・C7・N1〜N4・S1〜S4）は expect で確かめる。止まらない見込みの項目（C4〜C6・H・D3）は「実測」として結果を記録する。 C7 の WebAssembly は WebKit で止まらなかった（実測）ので、C7-wasm として test.fail で記録する。
// 結果は test-results/page-boundary-<ブラウザ>.json と、[measure] の行に出す。
import { test, expect, chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CANARY, canaryHits } from "./support/harness";

const HOST = "http://localhost:4316";
/** ブラウザごとに別の UDP の待ち受け（2 つのブラウザの試験が並行しても数が混ざらないように）。 */
const UDP_PORT = { chromium: 4318, webkit: 4319 } as Record<string, number>;
type Verdict = "止まった" | "止まらなかった" | "測れなかった";

function record(browserName: string, id: string, verdict: Verdict, detail: unknown) {
  const dir = join(process.cwd(), "test-results");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `page-boundary-${browserName}.json`);
  const all = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  all[id] = { verdict, detail };
  writeFileSync(f, JSON.stringify(all, null, 2));
  console.log(`[measure] page-boundary ${browserName} ${id} ${verdict} ${JSON.stringify(detail).slice(0, 600)}`);
}
const uid = () => Math.random().toString(36).slice(2, 10);
const hitsFor = async (id: string) => (await canaryHits()).filter((h: any) => h.path.includes(id));
async function udpHits(port: number): Promise<number> {
  return ((await (await fetch(`${CANARY}/__udp`)).json()) as Record<string, number>)[String(port)] ?? 0;
}
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | "timeout"> => Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

/** 作品を登録し、ホストの画面で開く。作品の文書の frame を返す。 */
async function openWork(page: Page, entry: string, o: { clock?: "manual" | "raf"; seed?: number; noRtc?: boolean } = {}): Promise<Frame> {
  const { token } = (await (await fetch(`${HOST}/__register`, { method: "POST", body: entry })).json()) as { token: string };
  const q = new URLSearchParams({ t: token, clock: o.clock ?? "raf", seed: String(o.seed ?? 1), ...(o.noRtc ? { noRtc: "1" } : {}) });
  await page.goto(`${HOST}/?${q}`);
  return innerFrame(page);
}
async function innerFrame(page: Page, timeout = 5000): Promise<Frame> {
  const t0 = Date.now();
  for (;;) {
    const f = page.frames().find((x) => x.url().includes("/p/"));
    if (f) return f;
    if (Date.now() - t0 > timeout) throw new Error("作品の文書が開かない");
    await page.waitForTimeout(50);
  }
}
/** 作品が window.__r に結果を書き、window.__done を真にするのを待つ。 */
async function result(f: Frame, timeout = 8000): Promise<any> {
  await f.waitForFunction(() => (window as any).__done === true, null, { timeout });
  return f.evaluate(() => (window as any).__r);
}
// 作品の本文の雛形：非同期の試しを走らせ、結果を __r に置く
const work = (body: string) => `(async () => { const r = (window.__r = {}); try { ${body} } catch (e) { r.fatal = String(e); } window.__done = true; })();`;
const blocked = (v: unknown) => !String(v).startsWith("reached") && !String(v).startsWith("ran");

test.describe("ページ直接モードの境界：通信", () => {
  test("C1 fetch・XHR・WebSocket・EventSource・sendBeacon がカナリアに届かない", async ({ page, browserName }) => {
    const id = uid();
    const f = await openWork(page, work(`
      const u = "${CANARY}/c1-${id}";
      try { await fetch(u + "/fetch"); r.fetch = "reached"; } catch (e) { r.fetch = "blocked:" + e.name; }
      try { await fetch(u + "/nocors", { mode: "no-cors" }); r.nocors = "reached"; } catch (e) { r.nocors = "blocked:" + e.name; }
      await new Promise((res) => { try { const x = new XMLHttpRequest(); x.open("GET", u + "/xhr"); x.onload = () => { r.xhr = "reached"; res(); }; x.onerror = () => { r.xhr = "blocked"; res(); }; x.send(); } catch (e) { r.xhr = "threw:" + e.name; res(); } });
      await new Promise((res) => { try { const w = new WebSocket("${CANARY.replace("http", "ws")}/c1-${id}-ws"); w.onopen = () => { r.ws = "reached"; res(); }; w.onerror = () => { r.ws = "blocked"; res(); }; } catch (e) { r.ws = "threw:" + e.name; res(); } setTimeout(res, 1500); });
      await new Promise((res) => { try { const s = new EventSource(u + "/sse"); s.onopen = () => { r.sse = "reached"; res(); }; s.onerror = () => { r.sse = "blocked"; s.close(); res(); }; } catch (e) { r.sse = "threw:" + e.name; res(); } setTimeout(res, 1500); });
      try { r.beacon = navigator.sendBeacon(u + "/beacon", "x") ? "queued" : "refused"; } catch (e) { r.beacon = "threw:" + e.name; }
    `));
    const r = await result(f);
    await page.waitForTimeout(800);
    const hits = await hitsFor(id);
    record(browserName, "C1", hits.length ? "止まらなかった" : "止まった", { r, hits });
    for (const k of ["fetch", "nocors", "xhr", "ws", "sse"]) expect(blocked(r[k])).toBe(true);
    expect(hits).toEqual([]);
  });

  test("C2 画像・映像・音声・スタイル・CSS の url()・@font-face がカナリアに届かない", async ({ page, browserName }) => {
    const id = uid();
    const f = await openWork(page, work(`
      const u = "${CANARY}/c2-${id}";
      new Image().src = u + "/image";
      const img = document.createElement("img"); img.src = u + "/img"; document.body.appendChild(img);
      const v = document.createElement("video"); v.src = u + "/video"; document.body.appendChild(v);
      const a = document.createElement("audio"); a.src = u + "/audio"; document.body.appendChild(a);
      const l = document.createElement("link"); l.rel = "stylesheet"; l.href = u + "/style.css"; document.head.appendChild(l);
      const s = document.createElement("style");
      s.textContent = "#c2bg{width:10px;height:10px;background:url(" + u + "/bg.png)} @font-face{font-family:c2f;src:url(" + u + "/font.woff)} #c2f{font-family:c2f}";
      document.head.appendChild(s);
      const d = document.createElement("div"); d.id = "c2bg"; document.body.appendChild(d);
      const t = document.createElement("span"); t.id = "c2f"; t.textContent = "font"; document.body.appendChild(t);
      try { await document.fonts.load("16px c2f"); } catch (e) {}
      await new Promise((res) => setTimeout(res, 1200));
      r.done = true;
    `));
    const r = await result(f);
    await page.waitForTimeout(500);
    const hits = await hitsFor(id);
    record(browserName, "C2", hits.length ? "止まらなかった" : "止まった", { r, hits });
    expect(hits).toEqual([]);
  });

  test("C3 <script src=カナリア> が読まれない・実行されない", async ({ page, browserName }) => {
    const id = uid();
    const f = await openWork(page, work(`
      addEventListener("message", (e) => { if (e.data && e.data.canary) r.executed = true; });
      await new Promise((res) => { const s = document.createElement("script"); s.src = "${CANARY}/c3-${id}/s.js"; s.onload = () => { r.script = "reached"; res(); }; s.onerror = () => { r.script = "blocked"; res(); }; document.head.appendChild(s); setTimeout(res, 1500); });
      await new Promise((res) => setTimeout(res, 300));
    `));
    const r = await result(f);
    const hits = await hitsFor(id);
    record(browserName, "C3", hits.length || r.executed ? "止まらなかった" : "止まった", { r, hits });
    expect(blocked(r.script)).toBe(true);
    expect(r.executed).toBeUndefined();
    expect(hits).toEqual([]);
  });

  test("C4 実測：dns-prefetch・preconnect・prefetch・preload の HTTP の到達", async ({ page, browserName }) => {
    const id = uid();
    const f = await openWork(page, work(`
      for (const [rel, as] of [["dns-prefetch"], ["preconnect"], ["prefetch"], ["preload", "script"], ["preload", "fetch"], ["preload", "image"]]) {
        const l = document.createElement("link"); l.rel = rel; if (as) l.as = as; if (as === "fetch") l.crossOrigin = "anonymous";
        l.href = "${CANARY}/c4-${id}/" + rel + (as ? "-" + as : ""); document.head.appendChild(l);
      }
      await new Promise((res) => setTimeout(res, 1500));
    `));
    await result(f);
    await page.waitForTimeout(500);
    const hits = await hitsFor(id);
    // DNS の問い合わせ（dns-prefetch）と、HTTP を伴わない接続（preconnect）は試験で数えられない
    record(browserName, "C4", hits.length ? "止まらなかった" : "止まった", { httpHits: hits.map((h: any) => h.path), dns: "測れなかった", preconnectTcp: "測れなかった" });
  });

  test("C5 実測：RTCPeerConnection の STUN の問い合わせ（UDP）", async ({ page, browserName }) => {
    const port = UDP_PORT[browserName];
    const before = await udpHits(port);
    const f = await openWork(page, work(`
      r.api = typeof RTCPeerConnection;
      if (typeof RTCPeerConnection === "function") {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${port}" }] });
        pc.createDataChannel("x");
        const cands = [];
        pc.onicecandidate = (e) => { if (e.candidate) cands.push(e.candidate.type || e.candidate.candidate.split(" ")[7]); };
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((res) => setTimeout(res, 3000));
        r.gathering = pc.iceGatheringState; r.candidates = cands; pc.close();
      }
    `));
    const r = await result(f, 12_000);
    await page.waitForTimeout(300);
    const udp = (await udpHits(port)) - before;
    record(browserName, "C5", r.api !== "function" ? "測れなかった" : udp > 0 ? "止まらなかった" : "止まった", { r, udpPackets: udp });
  });

  test("C6 実測：消した RTCPeerConnection を新しい窓から取り戻せるか", async ({ page, browserName }) => {
    const port = UDP_PORT[browserName];
    const before = await udpHits(port);
    const f = await openWork(
      page,
      work(`
      r.removed = typeof window.RTCPeerConnection;
      const fr = document.createElement("iframe"); document.body.appendChild(fr);
      let P = null;
      try { P = fr.contentWindow.RTCPeerConnection; r.fromIframe = typeof P; } catch (e) { r.fromIframe = "threw:" + e.name; }
      if (typeof P === "function") {
        const pc = new P({ iceServers: [{ urls: "stun:127.0.0.1:${port}" }] });
        pc.createDataChannel("x");
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((res) => setTimeout(res, 3000));
        pc.close();
      }
    `),
      { noRtc: true },
    );
    const r = await result(f, 12_000);
    await page.waitForTimeout(300);
    const udp = (await udpHits(port)) - before;
    record(browserName, "C6", r.fromIframe === "function" ? "止まらなかった" : "止まった", { r, udpPackets: udp, note: r.fromIframe === "function" ? "API を消す対策は効かない" : "新しい窓から取り出せなかった" });
  });

  test("C7 eval・new Function・WebAssembly.compile・Blob の Worker・serviceWorker がすべて失敗する", async ({ page, browserName }) => {
    const f = await openWork(page, work(`
      try { r.eval = "ran:" + (0, eval)("1+1"); } catch (e) { r.eval = "blocked:" + e.name; }
      try { r.fn = "ran:" + new Function("return 2")(); } catch (e) { r.fn = "blocked:" + e.name; }
      try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); r.wasm = "ran"; } catch (e) { r.wasm = "blocked:" + e.name; }
      await new Promise((res) => { try { const w = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" }))); w.onmessage = () => { r.worker = "ran"; res(); }; w.onerror = () => { r.worker = "blocked:error"; res(); }; setTimeout(() => { r.worker = r.worker || "blocked:silent"; res(); }, 1500); } catch (e) { r.worker = "blocked:" + e.name; res(); } });
      try { if (!navigator.serviceWorker) r.sw = "blocked:undefined"; else { await navigator.serviceWorker.register("/sw.js"); r.sw = "ran"; } } catch (e) { r.sw = "blocked:" + e.name; }
    `));
    const r = await result(f);
    const bad = ["eval", "fn", "wasm", "worker", "sw"].filter((k) => !blocked(r[k]));
    record(browserName, "C7", bad.length ? "止まらなかった" : "止まった", r);
    // WebAssembly.compile は別の試験（C7-wasm）で確かめる。ここでは残りの 4 つを確かめる
    expect(bad.filter((k) => k !== "wasm")).toEqual([]);
  });

  // WebKit では、wasm-unsafe-eval の無い CSP でも WebAssembly.compile が通った（実測）。条件は緩めず、
  // 止まらないことを test.fail で記録する（WebKit が止めるようになれば、この試験は「予期せず通った」で落ちて知らせる）。
  test("C7-wasm WebAssembly.compile が失敗する", async ({ page, browserName }) => {
    test.fail(browserName === "webkit", "WebKit では CSP（wasm-unsafe-eval なし）で WebAssembly.compile が止まらない（実測）");
    const f = await openWork(page, work(`
      try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); r.wasm = "ran"; } catch (e) { r.wasm = "blocked:" + e.name; }
    `));
    const r = await result(f);
    record(browserName, "C7-wasm", blocked(r.wasm) ? "止まった" : "止まらなかった", r);
    expect(blocked(r.wasm)).toBe(true);
  });
});

test.describe("ページ直接モードの境界：遷移・窓", () => {
  test("N1 自分の文書の遷移（location.href）がカナリアに届かない", async ({ page, browserName }) => {
    const id = uid();
    await openWork(page, `setTimeout(() => { location.href = "${CANARY}/n1-${id}?leak=1"; }, 200);`);
    await page.waitForTimeout(1500);
    const hits = await hitsFor(id);
    record(browserName, "N1", hits.length ? "止まらなかった" : "止まった", { hits });
    expect(hits).toEqual([]);
  });

  test("N2 meta refresh・<a target=_self>・<form> がカナリアに届かない", async ({ page, browserName }) => {
    const id = uid();
    const cases: Record<string, string> = {
      meta: `const m = document.createElement("meta"); m.httpEquiv = "refresh"; m.content = "0;url=${CANARY}/n2-${id}/meta"; document.head.appendChild(m);`,
      anchor: `const a = document.createElement("a"); a.href = "${CANARY}/n2-${id}/anchor"; a.target = "_self"; a.textContent = "a"; document.body.appendChild(a); a.click();`,
      form: `const fm = document.createElement("form"); fm.action = "${CANARY}/n2-${id}/form"; fm.method = "GET"; document.body.appendChild(fm); try { fm.submit(); } catch (e) {}`,
    };
    for (const [k, js] of Object.entries(cases)) {
      await openWork(page, `setTimeout(() => { ${js} }, 200);`);
      await page.waitForTimeout(1200);
      record(browserName, `N2-${k}`, (await hitsFor(`n2-${id}/${k}`)).length ? "止まらなかった" : "止まった", {});
    }
    const hits = await hitsFor(id);
    record(browserName, "N2", hits.length ? "止まらなかった" : "止まった", { hits });
    expect(hits).toEqual([]);
  });

  test("N3 window.open・<a target=_blank> で窓が開かない", async ({ page, context, browserName }) => {
    const id = uid();
    const pages0 = context.pages().length;
    let popups = 0;
    context.on("page", () => popups++);
    const f = await openWork(page, work(`
      try { const w = window.open("${CANARY}/n3-${id}/open"); r.open = w ? "opened" : "null"; } catch (e) { r.open = "threw:" + e.name; }
      const a = document.createElement("a"); a.href = "${CANARY}/n3-${id}/blank"; a.target = "_blank"; document.body.appendChild(a); a.click();
      await new Promise((res) => setTimeout(res, 1000));
    `));
    const r = await result(f);
    const hits = await hitsFor(id);
    record(browserName, "N3", popups || hits.length || r.open === "opened" ? "止まらなかった" : "止まった", { r, popups, hits });
    expect(r.open).not.toBe("opened");
    expect(popups).toBe(0);
    expect(context.pages().length).toBe(pages0);
    expect(hits).toEqual([]);
  });

  test("N4 top.location・parent.location を変えられない", async ({ page, browserName }) => {
    const id = uid();
    const f = await openWork(page, work(`
      try { top.location = "${CANARY}/n4-${id}/top"; r.top = "set"; } catch (e) { r.top = "threw:" + e.name; }
      try { parent.location = "${CANARY}/n4-${id}/parent"; r.parent = "set"; } catch (e) { r.parent = "threw:" + e.name; }
      try { top.location.href = "${CANARY}/n4-${id}/tophref"; r.topHref = "set"; } catch (e) { r.topHref = "threw:" + e.name; }
    `)).catch(() => null);
    const hostUrl0 = page.url();
    const r = f ? await result(f).catch(() => null) : null;
    await page.waitForTimeout(1200);
    const hits = await hitsFor(id);
    const shell = page.frames().find((x) => x.url().includes("/shell.html"));
    record(browserName, "N4", hits.length || !page.url().startsWith(HOST) || !shell ? "止まらなかった" : "止まった", { r, hostUrl: page.url(), shellUrl: shell?.url() ?? null, hits });
    expect(page.url()).toBe(hostUrl0);
    expect(shell).toBeTruthy();
    expect(hits).toEqual([]);
  });
});

test.describe("ページ直接モードの境界：親・保存", () => {
  test("S1 parent.document・top.document を読めない", async ({ page, browserName }) => {
    const f = await openWork(page, work(`
      try { r.parent = "reached:" + parent.document.title; } catch (e) { r.parent = "threw:" + e.name; }
      try { r.top = "reached:" + top.document.title; } catch (e) { r.top = "threw:" + e.name; }
    `));
    const r = await result(f);
    record(browserName, "S1", String(r.parent).startsWith("threw") && String(r.top).startsWith("threw") ? "止まった" : "止まらなかった", r);
    expect(String(r.parent).startsWith("threw")).toBe(true);
    expect(String(r.top).startsWith("threw")).toBe(true);
  });

  test("S2 localStorage・indexedDB・cookie・caches・navigator.storage でプレビューオリジンのデータに届かない", async ({ page, browserName }) => {
    const f = await openWork(page, work(`
      try { r.ls = "value:" + JSON.stringify(Object.keys(localStorage).map((k) => localStorage.getItem(k))); } catch (e) { r.ls = "threw:" + e.name; }
      try { r.cookie = "value:" + document.cookie; } catch (e) { r.cookie = "threw:" + e.name; }
      await new Promise((res) => { try { const q = indexedDB.open("x"); q.onsuccess = () => { r.idb = "opened"; res(); }; q.onerror = () => { r.idb = "error"; res(); }; } catch (e) { r.idb = "threw:" + e.name; res(); } setTimeout(res, 1500); });
      try { r.caches = typeof caches === "undefined" ? "undefined" : "value:" + JSON.stringify(await caches.keys()); } catch (e) { r.caches = "threw:" + e.name; }
      try { r.storage = navigator.storage ? "value:" + JSON.stringify(await navigator.storage.estimate()) : "undefined"; } catch (e) { r.storage = "threw:" + e.name; }
    `));
    const r = await result(f);
    const leaked = Object.entries(r).filter(([, v]) => String(v).includes("S3CRET")).map(([k]) => k);
    record(browserName, "S2", leaked.length ? "止まらなかった" : "止まった", { r, leaked });
    expect(leaked).toEqual([]);
    // 開けた indexedDB は不透明オリジンの一時的な領域であり、プレビューオリジンの保存データではない（記録だけ）
  });

  test("S3 parent・top への postMessage（save など）をホストが扱わない", async ({ page, browserName }) => {
    const f = await openWork(page, work(`
      parent.postMessage({ type: "save", runId: "r1", artworkId: "a" }, "*");
      top.postMessage({ type: "save", runId: "r1", artworkId: "a" }, "*");
      top.postMessage({ type: "ready", runId: "r1" }, "*");
      await new Promise((res) => setTimeout(res, 500));
    `));
    await result(f);
    const st = await page.evaluate(() => (window as any).__host);
    record(browserName, "S3", st.saves === 0 && !st.accepted.includes("save") ? "止まった" : "止まらなかった", { windowMessages: st.windowMessages, accepted: st.accepted });
    expect(st.saves).toBe(0);
    expect(st.accepted).not.toContain("save");
    // 窓の message は専用のポートを通らないので、ready も検査に入らない（受理は shell-ready の 1 件だけ）
    expect(st.accepted).toEqual(["shell-ready"]);
  });

  test("S4 シェルとの専用のポートを横取りしても、今ある型と上限のものしか通らない", async ({ page, browserName }) => {
    const f = await openWork(page, `
      addEventListener("message", (e) => {
        const p = e.ports && e.ports[0]; if (!p) return;
        p.postMessage({ type: "save", runId: "r1", artworkId: "a", expectedRevision: 1 });
        p.postMessage({ type: "grant", runId: "r1", permission: "network" });
        p.postMessage({ type: "status", runId: "r1", value: "x".repeat(9000) });
        p.postMessage({ type: "error", runId: "r1", message: "x".repeat(2000) });
        p.postMessage({ type: "ready", runId: "other" });
        p.postMessage({ type: "ready", runId: "r1", extra: 1 });
        p.postMessage({ type: "status", runId: "r1", value: { forged: true } });
        p.postMessage({ type: "shell-ready", protocol: 1 });
        setTimeout(() => { window.__done = true; }, 300);
      });`);
    await f.waitForFunction(() => (window as any).__done === true, null, { timeout: 5000 });
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => (window as any).__host);
    const known = ["shell-ready", "ready", "stopped", "escape", "advanced", "status", "error", "violation"];
    record(browserName, "S4", st.accepted.every((t: string) => known.includes(t)) ? "止まった" : "止まらなかった", { accepted: st.accepted, rejected: st.rejected });
    expect(st.accepted.every((t: string) => known.includes(t))).toBe(true);
    expect(st.rejected).toEqual(expect.arrayContaining(["save", "grant", "status", "error", "ready"]));
    expect(st.saves).toBe(0);
  });
});

/** 新しいコンテキストでホストの画面を開く（固まっても、閉じれば終わる）。 */
async function hostOperable(page: Page): Promise<boolean> {
  const t = await withTimeout(
    (async () => {
      const before = Number(await page.locator("#probe-count").textContent({ timeout: 2000 }));
      await page.locator("#probe-button").click({ timeout: 2000 });
      await expect(page.locator("#probe-count")).toHaveText(String(before + 1), { timeout: 2000 });
      return true;
    })().catch(() => false),
    5000,
  );
  return t === true;
}
async function stopAndRestart(browser: Browser, page: Page, browserName: string, id: string, extra: Record<string, unknown>) {
  const t0 = Date.now();
  const stop = await withTimeout(page.evaluate(() => (window as any).__stop(500)), 3000).catch((e) => "error:" + String(e).slice(0, 100));
  const { token } = (await (await fetch(`${HOST}/__register`, { method: "POST", body: `(function tick(){ window.__alive = (window.__alive || 0) + 1; requestAnimationFrame(tick); })();` })).json()) as { token: string };
  const mounted = await withTimeout(page.evaluate((t) => (window as any).__reopen(t), token), 2000).catch(() => "error");
  let alive = false;
  while (Date.now() - t0 < 2000 && mounted !== "timeout") {
    const f = page.frames().find((x) => x.url().includes("/p/" + token));
    if (f) {
      const n = await withTimeout(f.evaluate(() => (window as any).__alive || 0), 500).catch(() => 0);
      if (typeof n === "number" && n > 3) { alive = true; break; }
    }
    await page.waitForTimeout(50);
  }
  const ms = Date.now() - t0;
  const operable = await hostOperable(page);
  record(browserName, id, alive && operable ? "止まった" : "止まらなかった", { ...extra, stop, restartWithin2s: alive, restartMs: ms, hostOperableAfter: operable });
}

test.describe("ページ直接モードの境界：停止（実測）", () => {
  test.setTimeout(60_000);
  // Playwright の既定の Chromium（headless shell）はサイトごとのプロセス分離が無く、ホストと作品が同じプロセスに入る（実測）。
  // 実際の Chrome の既定に近い条件として、Chromium では --site-per-process で起動したものでも測り、「@site-per-process」を付けて記録する。
  const variants = [
    { suffix: "", args: null as string[] | null },
    { suffix: "@site-per-process", args: ["--site-per-process"] },
  ];
  for (const kind of ["loop", "bloat"] as const)
  for (const v of variants) {
    test(`${kind === "loop" ? "H1・H2" : "H3"}${v.suffix} 実測：${kind === "loop" ? "無限ループ" : "DOM・メモリを使い続ける"}作品の間のホストの操作と停止`, async ({ browser: given, browserName }) => {
      test.skip(!!v.args && browserName !== "chromium", "プロセス分離の起動引数は Chromium だけ");
      const own = v.args ? await chromium.launch({ args: v.args }) : null;
      const browser = own ?? given;
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
      try {
        const page = await ctx.newPage();
        const entry =
          kind === "loop"
            ? `setTimeout(() => { for (;;) {} }, 300);`
            : `const keep = []; setInterval(() => { for (let i = 0; i < 2000; i++) document.body.appendChild(document.createElement("div")); keep.push(new Uint8Array(1 << 20).fill(1)); }, 50);`;
        await openWork(page, entry);
        await page.waitForTimeout(kind === "loop" ? 800 : 2000);
        const operable = await hostOperable(page);
        if (kind === "loop") record(browserName, "H1" + v.suffix, operable ? "止まった" : "止まらなかった", { hostOperable: operable });
        await stopAndRestart(browser, page, browserName, (kind === "loop" ? "H2" : "H3") + v.suffix, { hostOperableDuring: operable });
      } finally {
        // 固まったときも必ず閉じる（閉じるのを待ちすぎない）
        await withTimeout(ctx.close(), 10_000);
        if (own) await withTimeout(own.close(), 10_000);
      }
    });
  }
});

test.describe("ページ直接モードの境界：観測の再現性", () => {
  const ANIM = `
    const c = document.getElementById("stage").getContext("2d");
    let x = 0; const t0 = Date.now(); window.__times = [];
    setTimeout(() => { x += 40; }, 300);
    function f(t) { window.__times.push([t, performance.now()]);
      c.fillStyle = "#000"; c.fillRect(0, 0, 480, 360);
      c.fillStyle = "hsl(" + Math.floor(Math.random() * 360) + ",80%,50%)";
      c.fillRect((x + (Date.now() - t0) / 10) % 440, 100 + Math.random() * 200, 40, 40);
      requestAnimationFrame(f); }
    requestAnimationFrame(f);`;
  const run = async (page: Page) => {
    const f = await openWork(page, ANIM, { clock: "manual", seed: 7 });
    await f.waitForFunction(() => (window as any).__rt && (window as any).__times);
    await f.evaluate(() => (window as any).__rt.advance(1000));
    return f.evaluate(() => ({ img: (document.getElementById("stage") as HTMLCanvasElement).toDataURL(), times: (window as any).__times, calls: (window as any).__rt.rafCalls }));
  };

  test("D1・D2 手動の時計で 2 回動かすと同じ画面になり、rAF は 16ms ごとに仮想の時刻で呼ばれる", async ({ page, browserName }) => {
    const a = await run(page);
    const b = await run(page);
    const sameImage = a.img === b.img;
    const virtual = a.times.every(([t, p]: number[], i: number) => t === (i + 1) * 16 && p === t);
    record(browserName, "D1", sameImage ? "止まった" : "止まらなかった", { sameImage });
    record(browserName, "D2", a.calls === 62 && virtual ? "止まった" : "止まらなかった", { rafCalls: a.calls, virtualTimes: virtual, first: a.times.slice(0, 3) });
    expect(sameImage).toBe(true);
    expect(a.calls).toBe(62);
    expect(virtual).toBe(true);
  });

  test("D3 実測：新しい窓から差し替える前の Date.now を取り出せるか", async ({ page, browserName }) => {
    const f = await openWork(page, work(`
      const fr = document.createElement("iframe"); document.body.appendChild(fr);
      r.virtual = Date.now();
      try { r.fromIframe = fr.contentWindow.Date.now(); } catch (e) { r.fromIframe = "threw:" + e.name; }
    `), { clock: "manual" });
    const r = await result(f);
    const real = typeof r.fromIframe === "number" && Math.abs(r.fromIframe - Date.now()) < 60_000;
    record(browserName, "D3", real ? "止まらなかった" : "止まった", { ...r, note: real ? "実時間を取り出せる（再現性は作品が意図して壊せる）" : "取り出せなかった" });
  });
});
