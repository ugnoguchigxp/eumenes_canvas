import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startCanvasApp } from "../../src/server/canvas-app";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { RecordedProvider } from "../../src/core/recorded-provider";
import { FakeObserver, P1, ROOT } from "./support";
import { readJson, startApp } from "../../src/server/app";

const app = startCanvasApp({
  hostPort: 4420,
  previewPort: 4421,
  makeService: () => new CanvasService({ store: new Store(null), model: new RecordedProvider([P1]), observer: new FakeObserver(), contract: "c" }),
});
afterAll(() => app.stop());
const H = app.hostOrigin;

test("IPv6 の待ち受けが起動できない場合にプレビューと IPv4 を解放する", async () => {
  const occupied = Bun.serve({ hostname: "::1", port: 0, fetch: () => new Response() });
  const spare = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const hostPort = occupied.port!;
  const previewPort = spare.port!;
  await spare.stop(true);
  const rebound = [];
  try {
    expect(() => startApp({ hostPort, previewPort })).toThrow();
    for (const port of [previewPort, hostPort]) {
      rebound.push(Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response() }));
    }
  } finally {
    await Promise.all([occupied, ...rebound].map((server) => server.stop(true)));
  }
});

test("制作サービスの初期化に失敗したら同じポートで起動し直せる", async () => {
  const listeners = Array.from({ length: 2 }, () => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
  const [hostPort, previewPort] = listeners.map((server) => server.port!);
  await Promise.all(listeners.map((server) => server.stop(true)));
  expect(() => startCanvasApp({ hostPort, previewPort, makeService: () => { throw new Error("初期化失敗"); } })).toThrow("初期化失敗");
  const restarted = startApp({ hostPort, previewPort });
  try {
    expect((await fetch(restarted.hostOrigin + "/api/config")).ok).toBe(true);
    expect((await fetch(restarted.previewOrigin + "/shell.html")).ok).toBe(true);
  } finally {
    restarted.stop();
  }
});

async function owner() {
  const r = await fetch(H + "/");
  return r.headers.get("set-cookie")!.split(";")[0];
}

describe("HTTP の境界", () => {
  test("ページは CSP・frame-ancestors・nosniff を返し、所有者 cookie は HttpOnly・SameSite=Strict", async () => {
    const r = await fetch(H + "/");
    expect(r.headers.get("content-security-policy")).toContain("frame-src http://127.0.0.1:4421");
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
  });
  test("Origin が違う変更要求は拒否する", async () => {
    const c = await owner();
    const r = await fetch(H + "/api/runs", { method: "POST", headers: { cookie: c, origin: "http://evil.example", "x-canvas-session": "session-x" }, body: JSON.stringify({ message: "落ち物ゲームを作って" }) });
    expect(r.status).toBe(403);
  });
  test("所有者 cookie がなければ API は 401", async () => {
    expect((await fetch(H + "/api/artworks")).status).toBe(401);
  });
  test("devHarness でなければ作品を直接登録できない", async () => {
    const r = await fetch(H + "/api/dev/preview", { method: "POST", headers: { origin: H }, body: "{}" });
    expect(r.status).toBe(404);
  });
  test("巨大な本文は 413", async () => {
    const c = await owner();
    const r = await fetch(H + "/api/runs", { method: "POST", headers: { cookie: c, origin: H, "x-canvas-session": "session-x" }, body: JSON.stringify({ message: "x".repeat(300 * 1024) }) });
    expect(r.status).toBe(413);
  });
  test("本文のバイト上限を受信途中で適用する", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("あいうえお"));
      },
      pull(controller) { controller.close(); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const req = new Request(H, { method: "POST", body });
    await expect(readJson(req, 14)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });
  test("本文のバイト上限ちょうどで、UTF-8 が分割されても読み取れる", async () => {
    const bytes = new TextEncoder().encode('{"message":"あ"}');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 13));
        controller.enqueue(bytes.subarray(13));
        controller.close();
      },
    });
    const req = new Request(H, { method: "POST", body });
    expect(await readJson(req, bytes.length)).toEqual({ message: "あ" });
  });
  test.each([
    ["/api/runs", null],
    ["/api/runs", { message: "落ち物ゲームを作って", artworkId: [] }],
    ["/api/candidates/c_missing/save", { expectedRevision: null, idempotencyKey: "request-key" }],
    ["/api/candidates/c_missing/save", { expectedRevision: 0, idempotencyKey: {} }],
    ["/api/artworks/a_missing/restore", { expectedRevision: 1, revision: 0, idempotencyKey: "request-key" }],
    ["/api/previews", { artworkId: "a_missing", revision: 1.5 }],
  ])("入力の型が違う %s は400", async (path, body) => {
    const r = await fetch(H + path, {
      method: "POST",
      headers: { cookie: await owner(), origin: H, "x-canvas-session": "session-x" },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(400);
  });
  test("プレビューの Worker 取得はトークン 1 回きりで、応答 CSP は default-src 'none'", async () => {
    const tok = app.tokens.issue({ title: "t", entry: "canvasApp.start(() => ({}));" });
    const r1 = await fetch(app.previewOrigin + "/w/" + tok, { headers: { "sec-fetch-dest": "worker" } });
    expect(r1.status).toBe(200);
    expect(r1.headers.get("content-security-policy")).toBe("default-src 'none'");
    const r2 = await fetch(app.previewOrigin + "/w/" + tok, { headers: { "sec-fetch-dest": "worker" } });
    expect(r2.status).toBe(410);
    const tok2 = app.tokens.issue({ title: "t", entry: "canvasApp.start(() => ({}));" });
    expect((await fetch(app.previewOrigin + "/w/" + tok2, { headers: { "sec-fetch-dest": "script" } })).status).toBe(403);
  });
  test("固定シェルの CSP はホストだけに埋め込みを許す", async () => {
    const r = await fetch(app.previewOrigin + "/shell.html");
    expect(r.headers.get("content-security-policy")).toContain(`frame-ancestors ${H}`);
    expect(r.headers.get("content-security-policy")).toContain("connect-src 'none'");
  });
});
