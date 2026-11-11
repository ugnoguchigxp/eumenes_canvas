import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artworkDigest } from "../../src/contract/artwork";
import { CanvasService } from "../../src/core/service";
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
  test("ファイルに同時保存しても同じ受領キーには同じ結果を返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-parallel-save-"));
    try {
      const { svc } = makeService({ dataDir: dir });
      const run = await runToEnd(svc, A, S1, { message: "落ち物ゲームを作って" });
      const options = { expectedRevision: 0, idempotencyKey: key("parallel") };
      const save = () => svc.save(A, run.candidates[0].id, options);
      const results = await Promise.all([save(), save()]);
      expect(results.map((r) => r.replay).sort()).toEqual([false, true]);
      expect(results[0].result).toEqual(results[1].result);
      expect(svc.listArtworks(A).map((a) => a.currentRevision)).toEqual([1]);
      expect(new Store(dir).receipt(A, options.idempotencyKey)?.result).toEqual(results[0].result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each(["restore", "save"] as const)("復元と同じ版からの %s が重なっても一方だけ確定する", async (operation) => {
    const { svc } = makeService();
    const { saved } = await createFallingBlock(svc);
    const run = await runToEnd(svc, A, S2, { message: "背景を紺色にして", artworkId: saved.artworkId, conversation: CONV });
    const restore = (k: string) => svc.restore(A, saved.artworkId, { revision: 1, expectedRevision: 1, idempotencyKey: key(k) });
    const first = restore("first");
    const second = operation === "restore" ? restore("second") : svc.save(A, run.candidates[0].id, { expectedRevision: 1, idempotencyKey: key("second") });
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409, extra: { code: "conflict" } } });
    expect(svc.getArtwork(A, saved.artworkId).revisions.map((r) => r.revision)).toEqual([1, 2]);
  });

  test("同時の復元で同じ受領キーに同じ結果を返す", async () => {
    const { svc } = makeService();
    const { saved } = await createFallingBlock(svc);
    const restore = () => svc.restore(A, saved.artworkId, { revision: 1, expectedRevision: 1, idempotencyKey: key("restore") });
    const results = await Promise.all([restore(), restore()]);
    expect(results.map((r) => r.replay).sort()).toEqual([false, true]);
    expect(results[0].result).toEqual(results[1].result);
    expect(svc.getArtwork(A, saved.artworkId).revisions.map((r) => r.revision)).toEqual([1, 2]);
  });

  test("保存と復元で同じ受領キーを同時に使うと一方を拒否する", async () => {
    const { svc } = makeService();
    const { saved } = await createFallingBlock(svc);
    const run = await runToEnd(svc, A, S2, { message: "背景を紺色にして", artworkId: saved.artworkId, conversation: CONV });
    const options = { expectedRevision: 1, idempotencyKey: key("mixed") };
    const results = await Promise.allSettled([
      svc.restore(A, saved.artworkId, { ...options, revision: 1 }),
      svc.save(A, run.candidates[0].id, options),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409, extra: { code: "idempotency-mismatch" } } });
    expect(svc.getArtwork(A, saved.artworkId).revisions).toHaveLength(2);
  });

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
  test("先の書き込みが終わらなくても期限に制作を中断し、確定後に期限切れを返す", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const store = new Store(null);
    const svc = new CanvasService({
      store, contract: "contract", observer: new FakeObserver(), runTimeoutMs: 200,
      model: {
        label: "deadline-test",
        async generate(_input, signal) {
          return new Promise<never>((_, reject) => signal.addEventListener("abort", () => {
            aborted.resolve();
            reject(new Error("aborted"));
          }, { once: true }));
        },
      },
    });
    const run = await svc.startRun(A, S1, { message: "落ち物ゲームを作って" });
    const blocked = store.write(async () => { entered.resolve(); await release.promise; });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await entered.promise;
      await Promise.race([aborted.promise, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("書き込みを待つ間に制作が中断されなかった")), 900);
      })]);
      expect(svc.getRun(A, run.id).state).toBe("running");
      release.resolve();
      await store.idle();
      expect(svc.getRun(A, run.id)).toMatchObject({ state: "expired", candidateIds: [] });
    } finally {
      clearTimeout(deadline);
      release.resolve();
      await blocked;
      await svc.close();
    }
  });

  test("終了は観測器を閉じて待機中の制作を中断し、新しい制作を受け付けない", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let closes = 0;
    const observer = new class extends FakeObserver {
      async observe(body: Parameters<FakeObserver["observe"]>[0]) {
        entered.resolve();
        await release.promise;
        return super.observe(body);
      }
      async close() {
        closes++;
        release.resolve();
      }
    }();
    const { svc } = makeService({ observer });
    const request = { message: "落ち物ゲームを作って" };
    try {
      const run = await svc.startRun(A, S1, request);
      await entered.promise;
      const closing = svc.close();
      expect(svc.close()).toBe(closing);
      await expect(svc.startRun(A, S2, request)).rejects.toMatchObject({ status: 503 });
      await closing;
      expect(closes).toBe(1);
      expect(svc.getRun(A, run.id)).toMatchObject({ state: "failed", failure: "ホストの終了で中断", candidateIds: [] });
    } finally {
      release.resolve();
      await svc.close();
    }
  });

  test("同時実行が満杯なら受け付けず、取消の処理が終われば再試行できる", async () => {
    const release = Promise.withResolvers<void>();
    const store = new Store(null);
    let calls = 0;
    const svc = new CanvasService({
      store,
      contract: "contract",
      observer: new FakeObserver(),
      model: {
        label: "capacity-test",
        async generate() {
          calls++;
          await release.promise;
          return { body: { title: "作品", entry: art("falling-block.js") }, changes: "", unconfirmed: [], reply: "" };
        },
      },
    });
    const req = { message: "落ち物ゲームを作って" };
    try {
      const runs = await Promise.all(Array.from({ length: 5 }, (_, i) => svc.startRun(A, "session-" + i, req)));
      await expect(svc.startRun(A, runs[0].session, req)).rejects.toMatchObject({ status: 429, extra: { code: "run-capacity" } });
      expect(svc.getRun(A, runs[0].id).state).toBe("running");
      await svc.cancelRun(A, runs[0].id);
      await expect(svc.startRun(A, S1, req)).rejects.toMatchObject({ status: 429, extra: { code: "run-capacity" } });
      expect(Object.keys(store.runs)).toHaveLength(5);
      expect(calls).toBe(5);
      release.resolve();
      await svc.drain();
      expect(svc.getRun(A, runs[0].id).candidates).toEqual([]);
      expect((await runToEnd(svc, A, S1, req)).state).toBe("presented");
    } finally {
      release.resolve();
      await svc.close();
    }
  });

  test.each(["generation", "deadline"] as const)("実行中の %s で書き込めないときは中断し、次の依頼を受ける", async (stage) => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-run-io-"));
    const blocked = join(dir, "store.json.tmp");
    const generated = Promise.withResolvers<void>();
    let first = true;
    const svc = new CanvasService({
      store: new Store(dir),
      contract: "contract",
      observer: new FakeObserver(),
      runTimeoutMs: stage === "deadline" ? 100 : 10_000,
      model: {
        label: "fault-test",
        async generate(_input, signal) {
          if (first) {
            first = false;
            if (stage === "deadline")
              signal.addEventListener("abort", () => generated.resolve(), { once: true });
            await generated.promise;
          }
          return { body: { title: "作品", entry: art("falling-block.js") }, changes: "", unconfirmed: [], reply: "" };
        },
      },
    });
    const req = { message: "落ち物ゲームを作って" };
    try {
      const run = await svc.startRun(A, S1, req);
      const running = svc.inflight.get(run.id);
      mkdirSync(blocked);
      if (stage === "generation") generated.resolve();
      await expect(running).resolves.toBeUndefined();
      const result = svc.getRun(A, run.id);
      expect(result.state).toBe("failed");
      expect(result.failure).toBeTruthy();
      expect(result.candidates).toEqual([]);
      expect(svc.listArtworks(A)).toEqual([]);
      rmSync(blocked, { recursive: true });
      expect((await runToEnd(svc, A, S1, req)).state).toBe("presented");
    } finally {
      generated.resolve();
      await svc.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 2500);

  test.each(["cancelled", "superseded"] as const)("ハッシュの照合中に %s になった候補は保存しない", async (state) => {
    const { svc } = makeService();
    const req = { message: "落ち物ゲームを作って" };
    const run = await runToEnd(svc, A, S1, req);
    const pending = svc.save(A, run.candidates[0].id, { expectedRevision: 0, idempotencyKey: key("stale") });
    if (state === "cancelled") await svc.cancelRun(A, run.id);
    else await svc.startRun(A, S1, req);
    try {
      await expect(pending).rejects.toMatchObject({ status: 409, extra: { code: "run-" + state } });
      expect(svc.listArtworks(A)).toEqual([]);
    } finally {
      await svc.drain();
    }
  });

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
    expect((await svc.cancelRun(A, run.id)).state).toBe("cancelled");
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
    await svc.cancelRun(A, r.id);
    await expect(svc.save(A, r.candidates[0].id, { expectedRevision: 0, idempotencyKey: key("c") })).rejects.toMatchObject({ status: 409, extra: { code: "run-cancelled" } });
  });

  test("検証後に実体を書き換えた候補は digest 不一致で保存できない", async () => {
    const { svc, store } = makeService();
    const r = await runToEnd(svc, A, S1, { message: "落ち物ゲームを作って" });
    const id = r.candidates[0].id;
    await store.write((commit) => commit(["candidates"], (state) => {
      const candidate = state.candidates[id];
      state.candidates[id] = { ...candidate, body: { ...candidate.body, entry: candidate.body.entry + "\n// 改ざん" } };
    }));
    await expect(svc.save(A, r.candidates[0].id, { expectedRevision: 0, idempotencyKey: key("t") })).rejects.toMatchObject({ status: 409, extra: { code: "digest-mismatch" } });
  });
});

describe("復元・再起動", () => {
  test("プレビューの応答を変更しても、保存した版と候補の記録は同じまま再起動後に読める", async () => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-preview-copy-"));
    try {
      const { svc, store } = makeService({ dataDir: dir });
      const { saved, cand } = await createFallingBlock(svc);
      const candidate = svc.resolvePreview(A, { candidateId: cand.id });
      const revision = svc.resolvePreview(A, { artworkId: saved.artworkId });
      const candidateView = svc.getRun(A, cand.runId).candidates[0];
      candidate.body.entry += "\n// 候補の表示だけを変更";
      revision.body.entry += "\n// 保存版の表示だけを変更";
      candidateView.unconfirmed.push("返却データだけに追記");
      await svc.restore(A, saved.artworkId, { revision: 1, expectedRevision: 1, idempotencyKey: key("readonly") });
      const reopened = new Store(dir);
      expect(reopened.candidates[cand.id].body).toEqual(store.candidates[cand.id].body);
      expect(reopened.candidates[cand.id].unconfirmed).not.toContain("返却データだけに追記");
      for (const row of reopened.revisionsOf(saved.artworkId)) {
        expect(row.body.entry).toBe(art("falling-block.js"));
        expect(await artworkDigest(row.body)).toBe(saved.digest);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("制作担当が入力を変更しても保存済みの元版は変わらない", async () => {
    const entry = art("falling-block.js");
    const svc = new CanvasService({
      store: new Store(null),
      contract: "contract",
      observer: new FakeObserver(),
      model: {
        label: "base-copy-test",
        async generate(input) {
          if (input.base) input.base.entry += "\n// 制作中の変更";
          return { body: { title: "落ち物ゲーム", entry }, changes: "", unconfirmed: [], reply: "" };
        },
      },
    });
    const { saved } = await createFallingBlock(svc);
    await runToEnd(svc, A, S1, { message: "作品を修正して", artworkId: saved.artworkId });
    expect(svc.resolvePreview(A, { artworkId: saved.artworkId, revision: 1 }).body.entry).toBe(entry);
    await expect(svc.restore(A, saved.artworkId, { revision: 1, expectedRevision: 1, idempotencyKey: key("base-copy") }))
      .resolves.toMatchObject({ result: { revision: 2, digest: saved.digest } });
  });

  test.each([
    ["save", "write"],
    ["save", "rename"],
    ["restore", "write"],
    ["restore", "rename"],
  ] as const)("%s の %s 失敗後に同じキーで再試行し、再起動できる", async (operation, fault) => {
    const dir = mkdtempSync(join(tmpdir(), "canvas-store-"));
    try {
      const { svc, store } = makeService({ dataDir: dir });
      const { saved } = await createFallingBlock(svc);
      const run = await runToEnd(svc, A, S2, { message: "背景を紺色にして", artworkId: saved.artworkId, conversation: CONV });
      const options = { expectedRevision: 1, idempotencyKey: key("failed") };
      const update = () => operation === "save"
        ? svc.save(A, run.candidates[0].id, options)
        : svc.restore(A, saved.artworkId, { ...options, revision: 1 });
      const file = join(dir, "store.json");
      const backup = file + ".backup";
      const blocked = fault === "write" ? file + ".tmp" : file;
      if (fault === "rename") renameSync(file, backup);
      mkdirSync(blocked);
      try {
        await expect(update()).rejects.toThrow();
        expect(svc.getArtwork(A, saved.artworkId).revisions.map((r) => r.revision)).toEqual([1]);
        expect(store.receipt(A, options.idempotencyKey)).toBeUndefined();
      } finally {
        rmSync(blocked, { recursive: true, force: true });
        if (fault === "rename") renameSync(backup, file);
      }
      const retried = await update();
      expect(retried).toMatchObject({ status: 200, replay: false, result: { revision: 2 } });
      const reopened = makeService({ dataDir: dir });
      expect(reopened.svc.getArtwork(A, saved.artworkId).revisions.map((r) => r.revision)).toEqual([1, 2]);
      expect(reopened.svc.resolvePreview(A, { artworkId: saved.artworkId }).body.entry)
        .toBe(art(operation === "save" ? "falling-block-navy.js" : "falling-block.js"));
      expect(reopened.store.receipt(A, options.idempotencyKey)?.result).toEqual(retried.result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
