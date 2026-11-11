// プレビュー接続の待ち時間・失敗・再接続（ブラウザの iframe を最小の偽物で置き換える）。
import { afterAll, describe, expect, mock, test } from "bun:test";
import * as messages from "../../src/shared/messages.js";

mock.module("/shared/messages.js", () => messages);
const { PreviewController, PreviewConnectError, CONNECT_TIMEOUT_MS, pageRefusal, isWebKitOnly, PAGE_WARNING } = await import("../../src/host/preview-client.js");

const ORIGIN = "http://127.0.0.1:49999";

/** reply が true のときだけ shell-ready を返す偽 iframe。 */
function fakeDocument(behaviour: { reply: boolean }) {
  const posted: { target: string }[] = [];
  class FakeFrame {
    listeners = new Map<string, Set<() => void>>();
    attrs: Record<string, string> = {};
    className = "";
    contentWindow = {
      postMessage: (msg: any, target: string, ports: MessagePort[]) => {
        posted.push({ target });
        if (behaviour.reply && msg?.type === "canvas-connect") ports[0].postMessage({ type: "shell-ready", protocol: messages.PROTOCOL_VERSION });
      },
    };
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    }
    addEventListener(t: string, f: () => void) {
      if (!this.listeners.has(t)) this.listeners.set(t, new Set());
      this.listeners.get(t)!.add(f);
    }
    removeEventListener(t: string, f: () => void) {
      this.listeners.get(t)?.delete(f);
    }
    set src(_v: string) {
      queueMicrotask(() => [...(this.listeners.get("load") ?? [])].forEach((f) => f()));
    }
    remove() {}
  }
  (globalThis as any).document = { createElement: () => new FakeFrame() };
  const container = { appendChild() {} };
  return { container, posted };
}

afterAll(() => {
  delete (globalThis as any).document;
});

describe("PreviewController の接続", () => {
  test("既定の待ち時間は 5 秒", () => expect(CONNECT_TIMEOUT_MS).toBe(5000));

  test("shell-ready が来なければ理由付きで失敗し、状態を failed にする", async () => {
    const env = fakeDocument({ reply: false });
    const states: string[] = [];
    const ctl = new PreviewController(env.container, { previewOrigin: ORIGIN, connectTimeoutMs: 50, onConnection: (s: string) => states.push(s) });
    const err = await ctl.mount().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PreviewConnectError);
    expect((err as any).code).toBe("preview-connect-timeout");
    expect((err as any).previewOrigin).toBe(ORIGIN);
    expect((err as any).message).toContain(ORIGIN);
    expect(states).toEqual(["connecting", "failed"]);
    expect(ctl.isConnected).toBe(false);
    expect(env.posted.every((p) => p.target === ORIGIN)).toBe(true); // 送り先のオリジンは固定のまま
  });

  test("失敗後の mount は読み直して再接続し、応答があれば connected になる", async () => {
    const behaviour = { reply: false };
    const env = fakeDocument(behaviour);
    const states: string[] = [];
    const ctl = new PreviewController(env.container, { previewOrigin: ORIGIN, connectTimeoutMs: 50, onConnection: (s: string) => states.push(s) });
    await ctl.mount().catch(() => {});
    behaviour.reply = true;
    await ctl.mount();
    expect(ctl.isConnected).toBe(true);
    expect(states).toEqual(["connecting", "failed", "connecting", "connected"]);
  });

  test("start は接続できないとき PreviewConnectError で終わり、作品を送らない", async () => {
    const env = fakeDocument({ reply: false });
    const ctl = new PreviewController(env.container, { previewOrigin: ORIGIN, connectTimeoutMs: 30 });
    const err = await ctl.start({ token: "a".repeat(32) }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PreviewConnectError);
    expect(ctl.runId).toBeNull();
  });
});

describe("ページ直接モード（design.md §8）", () => {
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
  const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
  test("WebKit だけのブラウザと設定で無効なときは開かない。Chromium 系で設定が有効なときだけ開く", () => {
    expect(isWebKitOnly(SAFARI)).toBe(true);
    expect(isWebKitOnly(CHROME)).toBe(false);
    expect(pageRefusal({ pageMode: false, webkitOnly: false })).toContain("無効");
    expect(pageRefusal({ pageMode: true, webkitOnly: true })).toContain("Safari");
    expect(pageRefusal({ pageMode: true, webkitOnly: false })).toBeNull();
  });
  test("警告は WebRTC の外部通信が止められないことを伝える", () => expect(PAGE_WARNING).toContain("WebRTC"));
  test("start は runtime を page のときだけ送り、直接描画と同時には送らない", async () => {
    const env = fakeDocument({ reply: true });
    const ctl: any = new PreviewController(env.container, { previewOrigin: ORIGIN, connectTimeoutMs: 200 });
    await ctl.mount();
    const sent: any[] = [];
    const orig = ctl.port.postMessage.bind(ctl.port);
    ctl.port.postMessage = (m: any) => { sent.push(m); orig(m); };
    ctl._wait = () => Promise.resolve({ type: "timeout" });
    await ctl.start({ token: "a".repeat(32), clock: "raf", direct: true, runtime: "page" });
    await ctl.start({ token: "a".repeat(32), clock: "raf", direct: true });
    await ctl.start({ token: "a".repeat(32), clock: "raf" });
    expect(sent[0].runtime).toBe("page");
    expect("direct" in sent[0]).toBe(false);
    expect("runtime" in sent[1]).toBe(false);
    expect(sent[1].direct).toBe(true);
    expect(Object.keys(sent[2]).sort()).toEqual(["clock", "data", "runId", "seed", "token", "type"]);
  });
});
