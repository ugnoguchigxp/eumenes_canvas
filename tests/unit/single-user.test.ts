// 単一利用者モード（design.md §3）：所有者 cookie で分けず、既存記録の owner は無視して全作品を見せる。
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCanvasApp, SINGLE_USER_OWNER } from "../../src/server/canvas-app";
import { singleUserOf } from "../../src/server/main";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { RecordedProvider } from "../../src/core/recorded-provider";
import { FakeObserver, makeService, P1, ROOT, runToEnd } from "./support";

const key = (s: string) => "k-" + s.padEnd(8, "x");

describe("設定", () => {
  test("既定の canvas.config.json は singleUser: true、項目が無ければ真、false のときだけ分ける", () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, "canvas.config.json"), "utf8"));
    expect(cfg.singleUser).toBe(true);
    expect(singleUserOf({})).toBe(true);
    expect(singleUserOf({ singleUser: true })).toBe(true);
    expect(singleUserOf({ singleUser: false })).toBe(false);
  });
});

describe("既存データの移行（owner を書き換えずに無視する）", () => {
  test("別の所有者で保存した作品が、再起動後の単一利用者モードで一覧・参照・プレビュー・修正・復元できる", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-single-"));
    try {
      const before = makeService({ dataDir: dir });
      const r = await runToEnd(before.svc, "old-cookie-owner-1234", "session-a", { message: "落ち物ゲームを作って" });
      const saved = (await before.svc.save("old-cookie-owner-1234", r.candidates[0].id, { expectedRevision: 0, idempotencyKey: key("old") })).result as any;
      await before.svc.drain();

      const after = makeService({ dataDir: dir, singleUser: true });
      const list = after.svc.listArtworks(SINGLE_USER_OWNER);
      expect(list.map((a) => [a.id, a.title, a.currentRevision])).toEqual([[saved.artworkId, "落ち物ゲーム", 1]]);
      expect(after.svc.getArtwork(SINGLE_USER_OWNER, saved.artworkId).owner).toBe("old-cookie-owner-1234"); // 記録は書き換えない
      expect(after.svc.resolvePreview(SINGLE_USER_OWNER, { artworkId: saved.artworkId }).body.title).toBe("落ち物ゲーム");
      const m = await runToEnd(after.svc, SINGLE_USER_OWNER, "session-b", {
        message: "落下の間隔を長くして",
        artworkId: saved.artworkId,
        conversation: [{ role: "user", text: "落ち物ゲームを作って" }, { role: "assistant", text: "落ち物ゲームを作りました。" }],
      });
      expect(m.state).toBe("presented");
      expect(((await after.svc.save(SINGLE_USER_OWNER, m.candidates[0].id, { expectedRevision: 1, idempotencyKey: key("mod") })).result as any).revision).toBe(2);
      expect(((await after.svc.restore(SINGLE_USER_OWNER, saved.artworkId, { revision: 1, expectedRevision: 2, idempotencyKey: key("rst") })).result as any).revision).toBe(3);
      // 版の照合は従来どおり（古い基準からの保存は競合）
      await expect(after.svc.restore(SINGLE_USER_OWNER, saved.artworkId, { revision: 1, expectedRevision: 2, idempotencyKey: key("rs2") })).rejects.toMatchObject({ status: 409 });
      await after.svc.drain();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("singleUser でないサービスは従来どおり別所有者に 404", async () => {
    const { svc } = makeService();
    const r = await runToEnd(svc, "owner-a", "session-a", { message: "落ち物ゲームを作って" });
    const saved = (await svc.save("owner-a", r.candidates[0].id, { expectedRevision: 0, idempotencyKey: key("a") })).result as any;
    expect(svc.listArtworks("owner-b")).toEqual([]);
    expect(() => svc.getArtwork("owner-b", saved.artworkId)).toThrow();
  });
});

describe("HTTP（単一利用者モード）", () => {
  const app = startCanvasApp({
    hostPort: 4450,
    previewPort: 4451,
    singleUser: true,
    makeService: ({ singleUser }) => new CanvasService({ store: new Store(null), model: new RecordedProvider([P1]), observer: new FakeObserver(), contract: "c", singleUser }),
  });
  afterAll(() => app.stop());
  const H = app.hostOrigin;

  test("ページは所有者 cookie を発行せず、CSP は従来どおり", async () => {
    const r = await fetch(H + "/");
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  test("cookie なしで依頼・保存した作品が、別の cookie を持つ要求からも一覧・参照できる", async () => {
    const post = (path: string, body: unknown, session = "session-x") =>
      fetch(H + path, { method: "POST", headers: { "content-type": "application/json", origin: H, "x-canvas-session": session }, body: JSON.stringify(body) });
    const run = (await (await post("/api/runs", { message: "落ち物ゲームを作って" })).json()) as any;
    await app.service.drain();
    const st = (await (await fetch(`${H}/api/runs/${run.id}`)).json()) as any;
    expect(st.state).toBe("presented");
    const sv = await post(`/api/candidates/${st.presentedCandidateId}/save`, { expectedRevision: 0, idempotencyKey: key("http") });
    expect(sv.status).toBe(200);
    const id = ((await sv.json()) as any).artworkId;
    const list = (await (await fetch(H + "/api/artworks", { headers: { cookie: "canvas_owner=someone-else-0123456789" } })).json()) as any[];
    expect(list.map((a) => a.id)).toEqual([id]);
    expect((await fetch(`${H}/api/artworks/${id}`)).status).toBe(200);
    expect(app.service.getArtwork(SINGLE_USER_OWNER, id).owner).toBe(SINGLE_USER_OWNER);
  });

  test("変更系 API は Origin が違えば 403、Origin なしも 403", async () => {
    const bad = await fetch(H + "/api/runs", { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example", "x-canvas-session": "session-x" }, body: JSON.stringify({ message: "落ち物ゲームを作って" }) });
    expect(bad.status).toBe(403);
    const none = await fetch(H + "/api/runs", { method: "POST", headers: { "content-type": "application/json", "x-canvas-session": "session-x" }, body: JSON.stringify({ message: "落ち物ゲームを作って" }) });
    expect(none.status).toBe(403);
    const prev = await fetch(H + "/api/previews", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:4451" }, body: "{}" });
    expect(prev.status).toBe(403);
  });

  test("x-canvas-session は引き続き必須", async () => {
    const r = await fetch(H + "/api/runs", { method: "POST", headers: { "content-type": "application/json", origin: H }, body: JSON.stringify({ message: "落ち物ゲームを作って" }) });
    expect(r.status).toBe(400);
  });
});
