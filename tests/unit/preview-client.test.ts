// プレビュー接続の待ち時間・失敗・再接続（ブラウザの iframe を最小の偽物で置き換える）。
import { afterAll, describe, expect, mock, test } from "bun:test";
import * as messages from "../../src/shared/messages.js";

mock.module("/shared/messages.js", () => messages);
const { PreviewController, PreviewConnectError, CONNECT_TIMEOUT_MS } = await import("../../src/host/preview-client.js");

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
