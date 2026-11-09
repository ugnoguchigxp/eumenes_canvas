// ホスト側のプレビュー制御。iframe を照合して専用ポートを渡し、シェルからの通知を検査する。
import { checkShellToHost, makeRateWindow } from "/shared/messages.js";

let seqCounter = 0;
function newRunId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return "r" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class PreviewController {
  constructor(container, { previewOrigin, onEvent } = {}) {
    this.container = container;
    this.previewOrigin = previewOrigin;
    this.onEvent = onEvent || (() => {});
    this.port = null;
    this.runId = null;
    this.waiters = new Map();
    this.readyCount = 0;
    this.rate = makeRateWindow();
    this.dropped = 0;
    this.lastStart = null;
  }

  mount() {
    if (this.iframe) return this.connected;
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

  _connect() {
    return new Promise((resolve) => {
      const f = this.iframe;
      const onLoad = () => {
        f.removeEventListener("load", onLoad);
        const ch = new MessageChannel();
        this.port = ch.port1;
        this.port.onmessage = (e) => this._onPort(e, resolve);
        f.contentWindow.postMessage({ type: "canvas-connect" }, this.previewOrigin, [ch.port2]);
      };
      f.addEventListener("load", onLoad);
      f.src = this.previewOrigin + "/shell.html";
    });
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
      const timer = setTimeout(() => {
        this.waiters.delete(key);
        resolve({ type: "timeout" });
      }, ms);
      this.waiters.set(key, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }

  /** 作品を起動する。ready・error・timeout のいずれかで解決する。 */
  async start({ token, data = null, seed = 1, clock = "raf" }) {
    await this.mount();
    this.runId = newRunId();
    this.lastStart = { data, seed, clock };
    const wait = this._wait("ready", 10_000);
    this.port.postMessage({ type: "start", runId: this.runId, token, data, seed, clock });
    return wait;
  }

  async advance(ms) {
    const seq = ++seqCounter;
    const wait = this._wait("advanced:" + seq, 10_000);
    this.port.postMessage({ type: "advance", runId: this.runId, seq, ms });
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
