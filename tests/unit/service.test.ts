import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artworkDigest } from "../../src/contract/artwork";
import { Store } from "../../src/core/store";
import { art, CONV, FakeObserver, makeService, runToEnd } from "./support";

const A = "ownerA", B = "ownerB", S1 = "session-1", S2 = "session-2";
const key = (s: string) => "k-" + s.padEnd(8, "x");

async function createFallingBlock(svc: any) {
  const r = await runToEnd(svc, A, S1, { message: "落ち物ゲームを作って" });
  expect(r.state).toBe("presented");
  const c = r.candidates[0];
  const saved = await svc.save(A, c.id, { expectedRevision: 0, idempotencyKey: key("new") });
  return { run: r, cand: c, saved: saved.result as any };
}

describe("新規・修正・保存", () => {
  test("新規の候補を検証して保存すると、digest が検証記録と一致する", async () => {
    const { svc, store } = makeService();
    const { cand, saved } = await createFallingBlock(svc);
    expect(cand.verification!.requiredPassed).toBe(true);
    expect(saved.revision).toBe(1);
    const rev = store.revisionsOf(saved.artworkId)[0];
    expect(rev.digest).toBe(await artworkDigest({ title: "落ち物ゲーム", entry: art("falling-block.js") }));
    expect(store.verifications[rev.verificationId].digest).toBe(rev.digest);
    expect(svc.listArtworks(A).length).toBe(1);
  });

  test("修正は基準 revision を持ち、保存すると新しい revision になる", async () => {
    const { svc } = makeService();
    const { saved } = await createFallingBlock(svc);
    const r = await runToEnd(svc, A, S1, { message: "落下の間隔を長くして", artworkId: saved.artworkId, conversation: CONV });
    expect(r.state).toBe("presented");
    expect(r.baseRevision).toBe(1);
    const s2 = await svc.save(A, r.candidates[0].id, { expectedRevision: 1, idempotencyKey: key("mod") });
    expect((s2.result as any).revision).toBe(2);
    const a = svc.getArtwork(A, saved.artworkId);
    expect(a.revisions.map((x: any) => x.parent)).toEqual([null, 1]);
  });

  test("重複保存は同じ受領結果を返し、同じキーで別操作は拒否する", async () => {
    const { svc } = makeService();
    const r = await runToEnd(svc, A, S1, { message: "落ち物ゲームを作って" });
    const k = key("dup");
    const a = await svc.save(A, r.candidates[0].id, { expectedRevision: 0, idempotencyKey: k });
    const b = await svc.save(A, r.candidates[0].id, { expectedRevision: 0, idempotencyKey: k });
    expect(b.replay).toBe(true);
    expect(b.result).toEqual(a.result);
    expect(svc.getArtwork(A, (a.result as any).artworkId).revisions.length).toBe(1);
    await expect(svc.save(A, r.candidates[0].id, { expectedRevision: 1, idempotencyKey: k })).rejects.toMatchObject({ status: 409 });
  });
});

describe("競合・所有者", () => {
  test("同じ版から作った 2 つの候補は、後に保存した方が競合になり、候補は残る", async () => {
    const { svc } = makeService();
    const { saved } = await createFallingBlock(svc);
    const ra = await runToEnd(svc, A, S1, { message: "落下の間隔を長くして", artworkId: saved.artworkId, conversation: CONV });
    const rb = await runToEnd(svc, A, S2, { message: "背景を紺色にして", artworkId: saved.artworkId, conversation: CONV });
    expect(ra.state).toBe("presented");
    expect(rb.state).toBe("presented");
    await svc.save(A, ra.candidates[0].id, { expectedRevision: 1, idempotencyKey: key("a") });
    await expect(svc.save(A, rb.candidates[0].id, { expectedRevision: 1, idempotencyKey: key("b") })).rejects.toMatchObject({ status: 409, extra: { code: "conflict", currentRevision: 2 } });
    // 古い候補で expectedRevision だけ合わせても採用しない
    await expect(svc.save(A, rb.candidates[0].id, { expectedRevision: 2, idempotencyKey: key("b2") })).rejects.toMatchObject({ status: 409, extra: { code: "conflict" } });
    expect(svc.getRun(A, rb.id).candidates.length).toBe(1);
    expect(svc.getArtwork(A, saved.artworkId).currentRevision).toBe(2);
  });

  test("別所有者は作品・候補・実行・プレビュー・復元のいずれにも届かない", async () => {
    const { svc } = makeService();
    const { run, cand, saved } = await createFallingBlock(svc);
    expect(() => svc.getArtwork(B, saved.artworkId)).toThrow();
    expect(() => svc.getRun(B, run.id)).toThrow();
    expect(() => svc.resolvePreview(B, { candidateId: cand.id })).toThrow();
    expect(() => svc.resolvePreview(B, { artworkId: saved.artworkId })).toThrow();
    await expect(svc.save(B, cand.id, { expectedRevision: 0, idempotencyKey: key("x") })).rejects.toMatchObject({ status: 404 });
    await expect(svc.restore(B, saved.artworkId, { revision: 1, expectedRevision: 1, idempotencyKey: key("y") })).rejects.toMatchObject({ status: 404 });
    await expect(svc.startRun(B, S1, { message: "落下の間隔を長くして", artworkId: saved.artworkId })).rejects.toMatchObject({ status: 404 });
    expect(svc.listArtworks(B)).toEqual([]);
  });
});

describe("失敗・取消・期限・撤回", () => {
  test("起動後のエラーを観測として返し、修正候補が合格する", async () => {
    const observer = new FakeObserver();
    await observer.failFor({ title: "ブロック崩し", entry: art("breakout-broken.js") }, "frame: bal is not defined");
    const { svc } = makeService({ observer });
    const r = await runToEnd(svc, A, S1, { message: "ブロック崩しを作って" });
    expect(r.state).toBe("presented");
    expect(r.candidates.length).toBe(2);
    expect(r.candidates[0].verification!.requiredPassed).toBe(false);
    expect(r.candidates[0].verification!.failedAt).toBe("no-runtime-error");
    expect(r.candidates[1].attempt).toBe(1);
    // 失敗した候補は保存できない
    await expect(svc.save(A, r.candidates[0].id, { expectedRevision: 0, idempotencyKey: key("f") })).rejects.toMatchObject({ status: 409 });
    await svc.save(A, r.candidates[1].id, { expectedRevision: 0, idempotencyKey: key("g") });
  });

  test("修正の記録がなければ初回＋2 回の上限内で失敗として閉じる", async () => {
    const observer = new FakeObserver();
    await observer.failFor({ title: "落ち物ゲーム", entry: art("falling-block.js") }, "boom");
    const { svc } = makeService({ observer });
    const r = await runToEnd(svc, A, S1, { message: "落ち物ゲームを作って" });
    expect(r.state).toBe("failed");
    expect(r.attempts).toBe(1); // 2 回目の入力は記録にないため生成失敗
    expect(r.failure).toContain("記録にない入力");
  });

  test("取消後に届いた結果は採用しない", async () => {
    const { svc, observer } = makeService({ deliverAfterAbort: true });
    const run = await svc.startRun(A, S1, { message: "回避ゲームを作って" });
    await new Promise((r) => setTimeout(r, 50));
    expect(svc.cancelRun(A, run.id).state).toBe("cancelled");
    await svc.inflight.get(run.id);
    const r = svc.getRun(A, run.id);
    expect(r.state).toBe("cancelled");
    expect(r.candidates.length).toBe(0);
    expect(observer.calls).toBe(0);
  }, 10_000);

  test("期限を過ぎた結果は採用しない", async () => {
    const { svc } = makeService({ deliverAfterAbort: true, runTimeoutMs: 300 });
    const run = await svc.startRun(A, S1, { message: "回避ゲームを作って" });
    await svc.inflight.get(run.id);
    const r = svc.getRun(A, run.id);
    expect(r.state).toBe("expired");
    expect(r.candidates.length).toBe(0);
  }, 10_000);

  test("同じ制作画面で新しい依頼を出すと古い実行は撤回され、その結果は採用しない", async () => {
    const { svc } = makeService({ deliverAfterAbort: true });
    const old = await svc.startRun(A, S1, { message: "回避ゲームを作って" });
    const fresh = await runToEnd(svc, A, S1, { message: "落ち物ゲームを作って" });
    expect(fresh.state).toBe("presented");
    await svc.inflight.get(old.id);
    const r = svc.getRun(A, old.id);
    expect(r.state).toBe("superseded");
    expect(r.candidates.length).toBe(0);
  }, 10_000);

  test("提示後に取消した候補は保存できない", async () => {
    const { svc } = makeService();
    const r = await runToEnd(svc, A, S1, { message: "落ち物ゲームを作って" });
    svc.cancelRun(A, r.id);
    await expect(svc.save(A, r.candidates[0].id, { expectedRevision: 0, idempotencyKey: key("c") })).rejects.toMatchObject({ status: 409, extra: { code: "run-cancelled" } });
  });

  test("検証後に実体を書き換えた候補は digest 不一致で保存できない", async () => {
    const { svc, store } = makeService();
    const r = await runToEnd(svc, A, S1, { message: "落ち物ゲームを作って" });
    store.candidates[r.candidates[0].id].body.entry += "\n// 改ざん";
    await expect(svc.save(A, r.candidates[0].id, { expectedRevision: 0, idempotencyKey: key("t") })).rejects.toMatchObject({ status: 409, extra: { code: "digest-mismatch" } });
  });
});

describe("復元・再起動", () => {
  test("過去の版を新しい revision として復元し、履歴をたどれる", async () => {
    const { svc } = makeService();
    const { saved } = await createFallingBlock(svc);
    const r = await runToEnd(svc, A, S1, { message: "落下の間隔を長くして", artworkId: saved.artworkId, conversation: CONV });
    await svc.save(A, r.candidates[0].id, { expectedRevision: 1, idempotencyKey: key("m") });
    await expect(svc.restore(A, saved.artworkId, { revision: 1, expectedRevision: 1, idempotencyKey: key("r0") })).rejects.toMatchObject({ status: 409 });
    const res = (await svc.restore(A, saved.artworkId, { revision: 1, expectedRevision: 2, idempotencyKey: key("r1") })).result as any;
    expect(res).toMatchObject({ revision: 3, restoredFrom: 1 });
    const a = svc.getArtwork(A, saved.artworkId);
    expect(a.revisions.map((x: any) => [x.revision, x.parent, x.restoredFrom])).toEqual([[1, null, null], [2, 1, null], [3, 2, 1]]);
    expect(a.revisions[2].digest).toBe(a.revisions[0].digest);
    expect(svc.resolvePreview(A, { artworkId: saved.artworkId }).body.entry).toBe(art("falling-block.js"));
  });

  test("再起動後も保存版を開け、実行中だった作業は結果不明として閉じる", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-store-"));
    try {
      const first = makeService({ dataDir: dir });
      const { saved } = await createFallingBlock(first.svc);
      await first.svc.startRun(A, S1, { message: "回避ゲームを作って" }); // 実行中のまま
      const store2 = new Store(dir);
      expect(Object.values(store2.runs).filter((r) => r.state === "running")).toEqual([]);
      const second = makeService({ dataDir: dir });
      expect(second.svc.resolvePreview(A, { artworkId: saved.artworkId }).body.entry).toBe(art("falling-block.js"));
      expect(second.svc.listArtworks(A).length).toBe(1);
      await first.svc.drain();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("入力と記録", () => {
  test("記録にない入力は推測で埋めず失敗にする", async () => {
    const { svc } = makeService();
    const r = await runToEnd(svc, A, S1, { message: "パズルゲームを作って" });
    expect(r.state).toBe("failed");
    expect(r.candidates.length).toBe(0);
  });
  test("非ゲーム可視化は登録済みの読み取り専用データを参照する", async () => {
    const { svc } = makeService();
    const r = await runToEnd(svc, A, S1, { message: "合成データの売上を棒グラフにして、凡例のクリックで地域を絞り込めるようにして" });
    expect(r.state).toBe("presented");
    const p = svc.resolvePreview(A, { candidateId: r.candidates[0].id });
    expect((p.data as any).categories.length).toBe(3);
    expect(p.body.dataRef).toBe("synthetic-sales");
  });
});
