// 10：ページ直接モード（作品を DOM のある文書のメインスレッドで動かす方式）の境界を測るための、試験用の配信。
// 製品コード（src/）からは参照しない。製品のプレビューに内側の iframe の経路は足さない（docs/agent-plan/10-page-mode.md）。
//
// ホスト（http://localhost:<hostPort>/?t=<token>&clock=manual|raf）
//   └─ iframe：シェル（http://127.0.0.1:<previewPort>/shell.html）  sandbox="allow-scripts allow-same-origin"
//        └─ iframe：作品の文書（/p/<token>）                         sandbox="allow-scripts"（不透明オリジン）
//              ├─ <canvas id="stage">
//              ├─ 固定の実行時コード（/rt.js：仮想の時計・seed 固定の乱数・RTCPeerConnection を消す）
//              └─ 作品の本文（/w/<token>、1 回だけ読める）
// ホストは専用のポート（MessageChannel）で受けたメッセージだけを checkShellToHost で検査する。窓の message は数えるだけで扱わない。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = join(import.meta.dir, "../../..");

/** 作品の文書の CSP（10 §2 の案）。script-src は 'self' ではなくプレビューオリジンを明示する。 */
export const pageCsp = (preview: string) =>
  `default-src 'none'; script-src ${preview}; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; ` +
  `connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'`;
/** シェルの CSP。frame-src にプレビューオリジンを足し、内側の iframe のほかのオリジンへの遷移を止める。 */
export const shellCsp = (preview: string) => `default-src 'none'; script-src ${preview}; style-src 'unsafe-inline'; frame-src ${preview}; connect-src 'none'; worker-src 'none'`;

// 固定の実行時コード。manual の時計では rAF・setTimeout・setInterval・performance.now・Date.now を仮想の時計に、Math.random を seed 固定に差し替える
const RUNTIME = `(() => {
  const P = new URLSearchParams(location.search);
  const clock = P.get("clock") === "manual" ? "manual" : "raf";
  let s = (Number(P.get("seed")) >>> 0) || 1;
  Math.random = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rt = { clock, now: 0, port: null, rafCalls: 0 };
  window.__rt = rt;
  if (clock === "manual") {
    const T0 = 1767225600000; // 仮想の Date.now の起点（固定）
    const raf = new Map(); let rafId = 0;
    const timers = new Map(); let timerId = 0;
    window.requestAnimationFrame = (f) => { raf.set(++rafId, f); return rafId; };
    window.cancelAnimationFrame = (id) => raf.delete(id);
    window.setTimeout = (f, ms = 0, ...a) => { timers.set(++timerId, { f, at: rt.now + Math.max(0, +ms || 0), every: 0, a }); return timerId; };
    window.setInterval = (f, ms = 0, ...a) => { const e = Math.max(1, +ms || 0); timers.set(++timerId, { f, at: rt.now + e, every: e, a }); return timerId; };
    window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
    performance.now = () => rt.now;
    Date.now = () => T0 + rt.now;
    // 16ms ごとに、期限の来たタイマーと rAF を呼ぶ（ホストが進める）
    rt.advance = (ms) => {
      const end = rt.now + ms;
      while (rt.now + 16 <= end) {
        rt.now += 16;
        for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
          if (t.at > rt.now) continue;
          if (t.every) t.at += t.every; else timers.delete(id);
          t.f(...t.a);
        }
        const fs = [...raf.values()]; raf.clear();
        for (const f of fs) { rt.rafCalls++; f(rt.now); }
      }
      rt.now = end;
    };
  }
  // RTCPeerConnection を消す（C6 で、新しい窓から取り戻せるかを測る）
  if (P.get("noRtc") === "1") for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) { try { delete window[k]; } catch {} try { Object.defineProperty(window, k, { value: undefined, configurable: false }); } catch {} }
  // シェルとの専用のポート（最初の 1 つだけ）
  addEventListener("message", (e) => { if (!rt.port && e.source === parent && e.ports[0]) { rt.port = e.ports[0]; rt.port.postMessage({ type: "page-ready" }); } });
})();`;

// シェル：内側の iframe を置き、ホストのポートとの間を中継する（最悪の場合として、作品のポートからのメッセージをそのままホストへ流す）
const SHELL = `(() => {
  const P = new URLSearchParams(location.search);
  try { localStorage.setItem("preview-secret", "S3CRET"); document.cookie = "preview=S3CRET"; } catch {}
  let host = null;
  let frame = null;
  function mount(token) {
    if (frame) frame.remove();
    frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.cssText = "border:0;width:480px;height:360px;display:block";
    frame.src = "/p/" + token + "?clock=" + encodeURIComponent(P.get("clock") || "manual") + "&seed=" + encodeURIComponent(P.get("seed") || "1") + (P.get("noRtc") === "1" ? "&noRtc=1" : "");
    frame.onload = () => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => host && host.postMessage(e.data);
      frame.contentWindow.postMessage({ type: "port" }, "*", [ch.port2]);
    };
    document.body.appendChild(frame);
  }
  addEventListener("message", (e) => {
    if (host || e.source !== parent || !e.ports[0]) return;
    host = e.ports[0];
    host.onmessage = (m) => {
      const d = m.data || {};
      if (d.type === "stop") { if (frame) { frame.remove(); frame = null; } host.postMessage({ type: "stopped", runId: "r1" }); }
      if (d.type === "mount") mount(d.token);
    };
    host.postMessage({ type: "shell-ready", protocol: 1 });
  });
})();`;

// ホストの画面：操作の確かめ（ボタン・入力）、ポートの検査、窓の message の数え、停止と読み直し
const hostJs = (preview: string) => `import { checkShellToHost } from "/messages.js";
const P = new URLSearchParams(location.search);
const st = window.__host = { accepted: [], rejected: [], windowMessages: 0, saves: 0, shellReady: 0, stopped: 0, log: [] };
document.getElementById("probe-button").onclick = () => { const c = document.getElementById("probe-count"); c.textContent = String(Number(c.textContent) + 1); };
// 窓の message（作品が parent・top へ送るもの）は数えるだけで扱わない
addEventListener("message", () => { st.windowMessages++; });
let port = null;
function openShell() {
  let mounted = false;
  const wrap = document.getElementById("wrap");
  wrap.textContent = "";
  const f = document.createElement("iframe");
  f.id = "shell";
  f.setAttribute("sandbox", "allow-scripts allow-same-origin");
  f.style.cssText = "border:0;width:500px;height:380px";
  f.src = "${preview}/shell.html?" + P.toString();
  f.onload = () => {
    const ch = new MessageChannel();
    port = ch.port1;
    port.onmessage = (e) => {
      const m = checkShellToHost(e.data, "r1");
      if (!m) { st.rejected.push(String(e.data && e.data.type).slice(0, 40)); return; }
      st.accepted.push(m.type);
      // shell-ready はシェル 1 つにつき最初の 1 回だけ扱う（作品がポートから偽の shell-ready を送っても、読み直しは起きない）
      if (m.type === "shell-ready") { st.shellReady++; if (!mounted && P.get("t")) { mounted = true; port.postMessage({ type: "mount", token: P.get("t") }); } }
      if (m.type === "stopped") st.stopped++;
    };
    f.contentWindow.postMessage({ type: "port" }, "${preview}", [ch.port2]);
  };
  wrap.appendChild(f);
}
// 停止：シェルに内側の iframe を外させる。応答が無ければシェルの iframe を読み直す
window.__stop = (waitMs = 500) => new Promise((res) => {
  const t0 = performance.now(); const before = st.stopped;
  if (port) port.postMessage({ type: "stop", runId: "r1" });
  const iv = setInterval(() => {
    if (st.stopped > before) { clearInterval(iv); res({ method: "shell", ms: performance.now() - t0 }); }
    else if (performance.now() - t0 > waitMs) { clearInterval(iv); openShellWith(null); res({ method: "reload-shell", ms: performance.now() - t0 }); }
  }, 20);
});
window.__mount = (token) => { if (port) port.postMessage({ type: "mount", token }); };
function openShellWith(token) { if (token) P.set("t", token); else P.delete("t"); openShell(); }
window.__reopen = openShellWith;
openShell();
`;

const hostHtml = (_preview: string) => `<!doctype html><meta charset="utf-8"><title>page-boundary host</title>
<button id="probe-button">押す</button> <span id="probe-count">0</span> <input id="probe-input">
<div id="wrap"></div>
<script type="module" src="/host.js"></script>`;

const pageHtml = (preview: string, token: string, query: string) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#000;overflow:hidden}#stage{width:480px;height:360px;display:block}</style>
<canvas id="stage" width="480" height="360"></canvas>
<script src="${preview}/rt.js${query}"></script>
<script src="${preview}/w/${token}"></script>`;

export interface PageBoundary {
  hostOrigin: string;
  previewOrigin: string;
  /** 作品の本文を登録し、1 回だけ使えるトークンを返す。 */
  register(entry: string): string;
}

export function startPageBoundary(hostPort: number, previewPort: number): PageBoundary {
  const hostOrigin = `http://localhost:${hostPort}`;
  const preview = `http://127.0.0.1:${previewPort}`;
  const works = new Map<string, { entry: string; docServed: boolean; bodyServed: boolean }>();
  const register = (entry: string) => {
    const t = randomBytes(18).toString("base64url");
    works.set(t, { entry, docServed: false, bodyServed: false });
    return t;
  };
  const messagesJs = readFileSync(join(ROOT, "src/shared/messages.js"), "utf8");
  Bun.serve({
    port: hostPort,
    hostname: "localhost",
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/") return new Response(hostHtml(preview), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src ${preview}` } });
      if (u.pathname === "/host.js") return new Response(hostJs(preview), { headers: { "content-type": "text/javascript; charset=utf-8" } });
      if (u.pathname === "/messages.js") return new Response(messagesJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      // 試験から作品を登録する（ループバックの試験だけが使う）
      if (u.pathname === "/__register" && req.method === "POST") return Response.json({ token: register(await req.text()) });
      return new Response("nf", { status: 404 });
    },
  });
  Bun.serve({
    port: previewPort,
    hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url);
      const js = { "content-type": "text/javascript; charset=utf-8" };
      if (u.pathname === "/shell.html")
        return new Response(`<!doctype html><meta charset="utf-8"><body style="margin:0"><script src="${preview}/shell.js"></script>`, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": shellCsp(preview) } });
      if (u.pathname === "/shell.js") return new Response(SHELL, { headers: js });
      if (u.pathname === "/rt.js") return new Response(RUNTIME, { headers: js });
      const p = /^\/p\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
      if (p) {
        const w = works.get(p[1]);
        if (!w || w.docServed) return new Response("gone", { status: 410 });
        w.docServed = true;
        return new Response(pageHtml(preview, p[1], u.search), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(preview) } });
      }
      const b = /^\/w\/([A-Za-z0-9_-]+)$/.exec(u.pathname);
      if (b) {
        const w = works.get(b[1]);
        if (!w || w.bodyServed) return new Response("gone", { status: 410 });
        w.bodyServed = true;
        return new Response(w.entry, { headers: js });
      }
      return new Response("nf", { status: 404 });
    },
  });
  return { hostOrigin, previewOrigin: preview, register };
}
