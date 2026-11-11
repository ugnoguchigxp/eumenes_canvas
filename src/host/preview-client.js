// ホスト側のプレビュー制御。iframe を照合して専用ポートを渡し、シェルからの通知を検査する。
import { checkShellToHost, makeRateWindow } from "/shared/messages.js";

/** shell-ready を待つ既定の上限（ミリ秒）。超えたら接続失敗として理由付きで終える。 */
export const CONNECT_TIMEOUT_MS = 5_000;

/** プレビューとの握手が成立しなかったことを表す。 */
export class PreviewConnectError extends Error {
  constructor(previewOrigin, timeoutMs) {
    super(`プレビュー ${previewOrigin} から ${timeoutMs}ms 以内に応答がありません`);
    this.name = "PreviewConnectError";
    this.code = "preview-connect-timeout";
    this.previewOrigin = previewOrigin;
    this.timeoutMs = timeoutMs;
  }
}

/** ページ直接モード（design.md §8）の作品を開くときの警告。作品を開くたびに出す。 */
export const PAGE_WARNING =
  "この作品はページ直接モードで動いています（作品をブラウザの文書で直接動かす方式）。通常の方式より隔離が弱く、" +
  "WebRTC による外部への通信は止められません。サイトごとのプロセス分離が有効な Chromium 系ブラウザで開いてください。" +
  "認証済みのデータを渡さず、信頼できない作品は開かないでください。";

/** WebKit だけのブラウザ（Safari など）か。Chromium 系は UA に Chrome・Chromium・Edg/ を含む。 */
export function isWebKitOnly(ua) {
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
}

export function isChromium(ua) {
  return /\b(?:Chrome|Chromium)\/\d/.test(ua) && !/\b(?:iPhone|iPad|iPod)\b/.test(ua);
}

/**
 * ページ直接モードの作品を開かない理由。開いてよいときは null。
 * 設定が有効で、Chromium 系と判定できるブラウザで開く。
 */
export function pageRefusal({ pageMode, chromium }) {
  if (!pageMode) return "ページ直接モードは設定で無効になっているため、この作品は開けません。";
  if (!chromium)
    return "ページ直接モードには Chromium 系のブラウザが必要です。作品の無限ループでホストの画面ごと固まるおそれがあるため、Safari（WebKit）では開きません。";
  return null;
}

let seqCounter = 0;
function newRunId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return "r" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class PreviewController {
  /**
   * @param {any} container
   * @param {{ previewOrigin?: string, onEvent?: (m: any) => void, onConnection?: (state: string, err: PreviewConnectError | null) => void, connectTimeoutMs?: number }} [opts]
   */
  constructor(container, { previewOrigin, onEvent, onConnection, connectTimeoutMs = CONNECT_TIMEOUT_MS } = {}) {
    this.container = container;
    this.previewOrigin = previewOrigin;
    this.onEvent = onEvent || (() => {});
    // 接続状態の変化（"connecting" | "connected" | "failed"）を知らせる
    this.onConnection = onConnection || (() => {});
    this.connectTimeoutMs = connectTimeoutMs;
    /** "idle" | "connecting" | "connected" | "failed" */
    this.connectionState = "idle";
    this.connectError = null;
    this.connectAttempts = 0;
    this.port = null;
    this.runId = null;
    this.waiters = new Map();
    this.readyCount = 0;
    this.rate = makeRateWindow();
    this.dropped = 0;
    this.lastStart = null;
  }

  /** iframe を置いて接続する。接続済みならそのまま、失敗済みなら読み直して再接続する。 */
  mount() {
    if (this.iframe) return this.connectionState === "failed" ? this.reconnect() : this.connected;
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-same-origin");
    f.setAttribute("allow", "");
    f.setAttribute("referrerpolicy", "no-referrer");
    f.setAttribute("title", "作品プレビュー");
    f.className = "preview-frame";
    this.iframe = f;
    this.connected = this._connect();
    this.container.appendChild(f);
    return this.connected;
  }

  /** 失敗した接続をやり直す（iframe を読み直す）。 */
  reconnect() {
    if (!this.iframe) return this.mount();
    if (this.connectionState === "connecting") return this.connected;
    if (this.port) this.port.close();
    this.port = null;
    this.runId = null;
    this.connected = this._connect();
    return this.connected;
  }

  _setConnection(st, err = null) {
    this.connectionState = st;
    this.connectError = err;
    this.onConnection(st, err);
  }

  _connect() {
    const attempt = ++this.connectAttempts;
    this._setConnection("connecting");
    const p = new Promise((resolve, reject) => {
      const f = this.iframe;
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        f.removeEventListener("load", onLoad);
        if (attempt !== this.connectAttempts) {
          // 新しい試行に置き換わった。待っている側は新しい試行の結果を受け取る
          this.connected.then(resolve, reject);
          return;
        }
        if (err) {
          if (this.port) this.port.close();
          this.port = null;
          this._setConnection("failed", err);
          reject(err);
        } else {
          this._setConnection("connected");
          resolve();
        }
      };
      const timer = setTimeout(() => finish(new PreviewConnectError(this.previewOrigin, this.connectTimeoutMs)), this.connectTimeoutMs);
      const onLoad = () => {
        f.removeEventListener("load", onLoad);
        if (done || attempt !== this.connectAttempts) return;
        const ch = new MessageChannel();
        this.port = ch.port1;
        this.port.onmessage = (e) => this._onPort(e, () => finish(null));
        // 送り先のオリジンが一致しない文書（遮断・エラーページ）には届かず、時間切れになる
        f.contentWindow.postMessage({ type: "canvas-connect" }, this.previewOrigin, [ch.port2]);
      };
      f.addEventListener("load", onLoad);
      f.src = this.previewOrigin + "/shell.html";
    });
    p.catch(() => {}); // 呼び出し側が待たない場合の未処理拒否を防ぐ
    return p;
  }

  _onPort(e, resolveConnected) {
    if (this.rate.hit() > 400) {
      this.dropped++;
      return;
    }
    const m = checkShellToHost(e.data, this.runId);
    if (!m) {
      this.dropped++;
      return;
    }
    if (m.type === "shell-ready") {
      resolveConnected();
      return;
    }
    if (m.type === "ready") this.readyCount++;
    this.onEvent(m);
    const w = this.waiters.get(m.type);
    if (w) {
      this.waiters.delete(m.type);
      w(m);
    }
    if (m.type === "advanced") {
      const k = "advanced:" + m.seq;
      const wa = this.waiters.get(k);
      if (wa) {
        this.waiters.delete(k);
        wa(m);
      }
    }
    if (m.type === "error" || m.type === "violation") {
      const wr = this.waiters.get("ready");
      if (wr) {
        this.waiters.delete("ready");
        wr(m);
      }
    }
  }

  _wait(key, ms) {
    return new Promise((resolve) => {
      const finish = (m) => {
        clearTimeout(timer);
        if (this.waiters.get(key) === finish) this.waiters.delete(key);
        resolve(m);
      };
      const timer = setTimeout(() => finish({ type: "timeout" }), ms);
      this.waiters.set(key, finish);
    });
  }

  /** 作品を起動する。ready・error・timeout・stopped などで解決する。 */
  async start({ token, data = null, seed = 1, clock = "raf", direct = false, runtime = undefined }) {
    await this.mount();
    this.waiters.get("ready")?.({ type: "stopped", runId: this.runId });
    this.runId = newRunId();
    this.lastStart = { data, seed, clock, direct };
    const wait = this._wait("ready", 10_000);
    // direct（直接描画）・runtime（ページ直接モード）は使うときだけ項目を入れる（使わないときは既存のメッセージと同じ形）
    const page = runtime === "page";
    this.port.postMessage({ type: "start", runId: this.runId, token, data, seed, clock, ...(direct && !page ? { direct: true } : {}), ...(page ? { runtime: "page" } : {}) });
    return wait;
  }

  async advance(ms) {
    const seq = ++seqCounter;
    const wait = this._wait("advanced:" + seq, 10_000);
    this.port.postMessage({ type: "advance", runId: this.runId, seq, ms });
    return wait;
  }

  /** 時間を進めない描き直し（frame(t, 0) を count 回）。返事は advance と同じ advanced。 */
  async poke(count) {
    const seq = ++seqCounter;
    const wait = this._wait("advanced:" + seq, 10_000);
    this.port.postMessage({ type: "poke", runId: this.runId, seq, count });
    return wait;
  }

  /** 停止。シェルが 300ms 以内に応答しなければ iframe を読み直して強制的に破棄する。 */
  async stop() {
    const t0 = performance.now();
    if (!this.port || !this.runId) return { method: "none", ms: 0 };
    const id = this.runId;
    const wait = this._wait("stopped", 300);
    this.port.postMessage({ type: "stop", runId: id });
    const r = await wait;
    if (this.runId !== id) return { method: "none", ms: performance.now() - t0 };
    this.waiters.get("ready")?.({ type: "stopped", runId: id });
    this.runId = null;
    if (r.type === "stopped") return { method: "terminate", ms: performance.now() - t0 };
    await this.hardReset();
    return { method: "reload", ms: performance.now() - t0 };
  }

  async hardReset() {
    if (this.port) this.port.close();
    this.port = null;
    this.runId = null;
    this.connected = this._connect();
    await this.connected;
  }

  /** 接続済みかどうか。 */
  get isConnected() {
    return this.connectionState === "connected" && !!this.port;
  }

  focus() {
    if (this.iframe) this.iframe.focus();
  }

  destroy() {
    if (this.port) this.port.close();
    if (this.iframe) this.iframe.remove();
    this.iframe = null;
    this.port = null;
  }
}
