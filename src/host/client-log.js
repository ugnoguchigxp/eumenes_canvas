// ホスト画面の診断ログ。イベントをまとめて /api/client-log へ送る（依頼の本文・トークン・session は送らない）。
// app.js とは別に読み込み、app.js の初期化が失敗しても例外を拾えるようにする。
const ENDPOINT = "/api/client-log";
const FLUSH_MS = 2000;
const BATCH = 20;
const MAX_QUEUE = 200;
const MAX_STR = 500;
const MAX_BYTES = 15 * 1024; // サーバーの上限 16 KiB より少し小さく

const page = (() => {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
})();
window.__canvasLogPage = page; // 試験での照合用（読み取りのみ）
let queue = [];
let seq = 0;
let timer = null;
let sending = false;

function str(v) {
  if (v instanceof Error) return `${v.name}: ${v.message}`.slice(0, MAX_STR);
  if (typeof v === "string") return v.slice(0, MAX_STR);
  try {
    return JSON.stringify(v).slice(0, MAX_STR);
  } catch {
    return String(v).slice(0, MAX_STR);
  }
}

/** 診断イベントを 1 件積む。fields は文字列・数値・真偽値だけにする。 */
export function clog(type, fields = {}) {
  const ev = { type, page, seq: ++seq, at: Date.now() };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    ev[k] = typeof v === "number" || typeof v === "boolean" ? v : str(v);
  }
  queue.push(ev);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (queue.length >= BATCH) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

function takeBatch() {
  const out = [];
  let bytes = 12;
  while (queue.length && out.length < 50) {
    const n = JSON.stringify(queue[0]).length + 1;
    if (bytes + n > MAX_BYTES) {
      if (!out.length) queue.shift(); // 1 件だけで上限を超えるものは捨てる
      break;
    }
    bytes += n;
    out.push(queue.shift());
  }
  return out;
}

/** 積んだイベントを送る。送信の失敗は記録し直さない（ループ防止）。 */
export async function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (sending || !queue.length) return;
  sending = true;
  try {
    while (queue.length) {
      const events = takeBatch();
      if (!events.length) break;
      await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }), keepalive: true }).catch(() => {});
    }
  } finally {
    sending = false;
  }
}

function beacon() {
  if (timer) clearTimeout(timer);
  timer = null;
  while (queue.length) {
    const events = takeBatch();
    if (!events.length) break;
    const body = JSON.stringify({ events });
    // keepalive の fetch を先に使う。WebKit の sendBeacon は画面遷移中に Origin: null を送り、Origin の照合で拒否されるため（実測）。
    // keepalive を使えない環境だけ sendBeacon に落とす。text/plain は CORS の事前確認を伴わず、サーバーは content-type によらず JSON として読む
    try {
      fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch {
      if (!navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) break;
    }
  }
}

window.addEventListener("error", (e) => clog("window.error", { message: e.message, file: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack }));
window.addEventListener("unhandledrejection", (e) => clog("unhandledrejection", { reason: e.reason, stack: e.reason?.stack }));
// CSP の違反（埋め込み・読込・通信の遮断）も残す
document.addEventListener("securitypolicyviolation", (e) => clog("csp.violation", { directive: e.violatedDirective, blocked: e.blockedURI, source: e.sourceFile, line: e.lineNumber }));
const origError = console.error.bind(console);
console.error = (...args) => {
  clog("console.error", { text: args.map(str).join(" ") });
  origError(...args);
};
// app.js とは独立に、押下と submit が画面に届いたか・その時点で app.js の初期化が済んでいたかを残す。
// app.js の初期化前に送信を押すと、フォームの既定動作でページが読み直される（その場合も pagehide で送り切る）
const appState = () => ({ appReady: document.body?.dataset.ready === "1", preview: document.body?.dataset.preview });
document.addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest("button") : null;
  if (b) clog("ui.click", { id: b.id || undefined, text: b.id ? undefined : (b.textContent || "").trim().slice(0, 20), disabled: b.disabled, ...appState() });
}, true);
document.addEventListener("submit", (e) => clog("ui.submit.capture", { form: e.target?.id, ...appState() }), true);
window.addEventListener("pagehide", beacon);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());

clog("page.boot", { path: location.pathname, ua: navigator.userAgent, lang: navigator.language, w: innerWidth, h: innerHeight });
