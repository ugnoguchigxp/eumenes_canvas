// 診断ログ：書式、伏せ字、切り替え、/api/client-log の境界。
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_LOG_LIMITS, JsonlLog, MinuteLimiter, isoWithOffset, logPath, sanitizeClientEvents } from "../../src/server/logs";
import { startCanvasApp } from "../../src/server/canvas-app";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { RecordedProvider } from "../../src/core/recorded-provider";
import { FakeObserver, P1 } from "./support";

const dir = mkdtempSync(join(tmpdir(), "canvas-logs-"));
const app = startCanvasApp({
  hostPort: 4430,
  previewPort: 4431,
  logDir: join(dir, "logs"),
  makeService: () => new CanvasService({ store: new Store(null), model: new RecordedProvider([P1]), observer: new FakeObserver(), contract: "c" }),
});
afterAll(() => {
  app.stop();
  rmSync(dir, { recursive: true, force: true });
});
const H = app.hostOrigin;
const lines = (f: string) => (existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const serverLog = () => lines(join(dir, "logs/server.log"));
const clientLog = () => lines(join(dir, "logs/client.log"));

describe("書式と伏せ字", () => {
  test("時刻は時差付きの ISO 8601", () => {
    expect(isoWithOffset(new Date("2026-11-09T13:00:00.000Z"))).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
  });
  test("問い合わせはキー名だけ、Worker のトークンは伏せる", () => {
    expect(logPath(new URL("http://x/?clock=manual&t=secret"))).toBe("/?clock&t");
    expect(logPath(new URL("http://x/w/abcDEF123"))).toBe("/w/[token]");
    expect(logPath(new URL("http://x/?"), "http://x/?")).toBe("/?");
    expect(logPath(new URL("http://x/"))).toBe("/");
  });
  test("診断イベントは平らな値だけを残し、件数と長さを抑える", () => {
    const r = sanitizeClientEvents({ events: [{ type: "a", n: 1, ok: true, obj: { x: 1 }, s: "x".repeat(900), "bad key": 1 }, { noType: 1 }] })!;
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ type: "a", n: 1, ok: true, s: "x".repeat(CLIENT_LOG_LIMITS.maxString) });
    expect(sanitizeClientEvents({ events: Array.from({ length: 51 }, () => ({ type: "a" })) })).toBeNull();
    expect(sanitizeClientEvents({})).toBeNull();
  });
  test("上限を超えたら .1 に移して 1 世代だけ残す", () => {
    const f = join(dir, "rot/x.log");
    const log = new JsonlLog(f, 300);
    for (let i = 0; i < 20; i++) log.write({ i, pad: "y".repeat(40) });
    expect(statSync(f).size).toBeLessThanOrEqual(300);
    expect(statSync(f + ".1").size).toBeLessThanOrEqual(300);
    expect(existsSync(f + ".2")).toBe(false);
    expect(lines(f).at(-1).i).toBe(19);
  });
  test("1 分の要求数を超えたら拒否する", () => {
    let t = 0;
    const l = new MinuteLimiter(2, () => t);
    expect([l.hit(), l.hit(), l.hit()]).toEqual([true, true, false]);
    t = 60_000;
    expect(l.hit()).toBe(true);
  });
});

describe("/api/client-log と server.log", () => {
  test("同じ Origin なら 204 で client.log に追記する（所有者 cookie は不要）", async () => {
    const r = await fetch(H + "/api/client-log", { method: "POST", headers: { origin: H }, body: JSON.stringify({ events: [{ type: "ui.submit", length: 9, ts: "forged" }] }) });
    expect(r.status).toBe(204);
    const ev = clientLog().find((e) => e.type === "ui.submit")!;
    expect(ev.length).toBe(9);
    expect(ev.ts).not.toBe("forged");
  });
  test("Origin が違えば 403、理由を server.log に残す", async () => {
    const r = await fetch(H + "/api/client-log", { method: "POST", headers: { origin: "http://evil.example" }, body: JSON.stringify({ events: [{ type: "x" }] }) });
    expect(r.status).toBe(403);
    const e = serverLog().find((l) => l.path === "/api/client-log" && l.status === 403)!;
    expect(e.reason).toBe("origin が一致しない");
    expect(e.origin).toBe("http://evil.example");
    expect(clientLog().some((l) => l.type === "x")).toBe(false);
  });
  test("16 KiB を超える本文は 413", async () => {
    const big = JSON.stringify({ events: [{ type: "big", s: "x".repeat(17 * 1024) }] });
    const r = await fetch(H + "/api/client-log", { method: "POST", headers: { origin: H }, body: big });
    expect(r.status).toBe(413);
  });
  test("server.log は本文・cookie・session・トークンを含まない", async () => {
    const cookie = (await fetch(H + "/")).headers.get("set-cookie")!.split(";")[0];
    await fetch(H + "/api/runs", { method: "POST", headers: { cookie, origin: H, "x-canvas-session": "session-secret-1" }, body: JSON.stringify({ message: "落ち物ゲームを作って" }) });
    const tok = app.tokens.issue({ title: "t", entry: "canvasApp.start(() => ({}));" });
    await fetch(app.previewOrigin + "/w/" + tok, { headers: { "sec-fetch-dest": "worker" } });
    const raw = readFileSync(join(dir, "logs/server.log"), "utf8");
    for (const secret of [cookie.split("=")[1], "session-secret-1", "落ち物ゲーム", tok]) expect(raw).not.toContain(secret);
    const run = serverLog().find((l) => l.path === "/api/runs" && l.method === "POST")!;
    expect(run.status).toBe(201);
    expect(run.server).toBe("host");
    expect(typeof run.ms).toBe("number");
    expect(["127.0.0.1", "::1"]).toContain(run.listen);
    const w = serverLog().find((l) => l.server === "preview" && l.path === "/w/[token]")!;
    expect(w.status).toBe(200);
    expect(w.sec_fetch_dest).toBe("worker");
    expect(serverLog().some((l) => l.event === "start")).toBe(true);
  });
});
