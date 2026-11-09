import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startCanvasApp } from "../../src/server/canvas-app";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { RecordedProvider } from "../../src/core/recorded-provider";
import { FakeObserver, P1, ROOT } from "./support";

const app = startCanvasApp({
  hostPort: 4420,
  previewPort: 4421,
  makeService: () => new CanvasService({ store: new Store(null), model: new RecordedProvider([P1]), observer: new FakeObserver(), contract: "c" }),
});
afterAll(() => app.stop());
const H = app.hostOrigin;

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
