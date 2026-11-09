// 制作コアとテスト用の版保存をつなぐサービス。
// 受付 → 生成 → 候補検査 → ブラウザ観測 → 候補提示。保存・復元は所有者・版・世代・digest・検証記録を照合する。
import { randomBytes } from "node:crypto";
import { artworkDigest, checkArtwork, checkData, sha256Hex, type ArtworkBody } from "../contract/artwork";
import type { DatasetInfo, GenerationInput, ModelPort } from "./model-port";
import type { ObserverPort } from "./observer";
import type { Store } from "./store";
import type { Artwork, Candidate, Observation, Revision, Run, Turn, Verification } from "./types";

export const MAX_FIX_ATTEMPTS = 2; // 初回 1 回＋修正 2 回
export const MAX_TURN_INFERENCES = 6; // 複数ターンの制作推論の合計

export interface Dataset extends DatasetInfo {
  data: unknown;
}

export interface ServiceOptions {
  /** 単一利用者モード。記録の owner を照合せず、全作品・実行・候補を見せる（design.md §3）。 */
  singleUser?: boolean;
  store: Store;
  model: ModelPort;
  observer: ObserverPort;
  contract: string;
  datasets?: Dataset[];
  runTimeoutMs?: number;
  now?: () => number;
}

export class ServiceError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const id = (p: string) => p + randomBytes(9).toString("base64url");

export class CanvasService {
  private aborts = new Map<string, AbortController>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private datasets = new Map<string, Dataset>();
  private now: () => number;
  readonly runTimeoutMs: number;
  /** 実行中の生成（試験で完了を待つため）。 */
  readonly inflight = new Map<string, Promise<void>>();

  constructor(private o: ServiceOptions) {
    this.now = o.now ?? (() => Date.now());
    this.runTimeoutMs = o.runTimeoutMs ?? 180_000;
    for (const d of o.datasets ?? []) {
      if (!checkData(d.data).ok) throw new Error(`データ ${d.ref} が上限を超える`);
      this.datasets.set(d.ref, d);
    }
  }

  datasetFor(body: ArtworkBody): unknown {
    return body.dataRef ? (this.datasets.get(body.dataRef)?.data ?? null) : null;
  }

  /** 記録の所有者が要求者と一致するか。単一利用者モードでは常に真（既存記録の owner は書き換えずに無視する）。 */
  private sees(recordOwner: string, owner: string): boolean {
    return !!this.o.singleUser || recordOwner === owner;
  }

  private ownArtwork(owner: string, artworkId: string): Artwork {
    const a = this.o.store.artworks[artworkId];
    if (!a || !this.sees(a.owner, owner)) throw new ServiceError(404, "作品が見つからない");
    return a;
  }

  // ---- 受付 ----
  async startRun(owner: string, session: string, req: { message: string; artworkId?: string | null; conversation?: Turn[] }): Promise<Run> {
    if (typeof req.message !== "string" || !req.message.trim() || req.message.length > 4000) throw new ServiceError(400, "依頼は 1〜4000 文字");
    const conversation = (req.conversation ?? []).slice(-20);
    if (conversation.filter((t) => t.role === "user").length >= MAX_TURN_INFERENCES) throw new ServiceError(429, "複数ターンの上限");
    let artworkId: string;
    let isNew = false;
    let base: Revision | null = null;
    if (req.artworkId) {
      const a = this.ownArtwork(owner, req.artworkId);
      artworkId = a.id;
      base = this.o.store.revisionsOf(a.id).find((r) => r.revision === a.currentRevision) ?? null;
    } else {
      artworkId = id("a_");
      isNew = true;
    }
    const run = this.o.store.tx((s) => {
      const generation = this.o.store.nextGeneration(s, owner, session, isNew ? "new" : artworkId);
      // 同じ制作画面の古い実行は撤回する（後から届いた結果を採用しない）
      for (const r of Object.values(s.runs))
        if (r.owner === owner && r.session === session && (isNew ? r.isNew : r.artworkId === artworkId) && r.generation < generation && (r.state === "running" || r.state === "presented")) {
          r.state = "superseded";
          r.finishedAt = this.now();
          this.aborts.get(r.id)?.abort();
        }
      const run: Run = {
        id: id("run_"),
        owner,
        session,
        artworkId,
        isNew,
        baseRevision: base?.revision ?? 0,
        baseDigest: base?.digest ?? null,
        generation,
        request: { message: req.message, conversation },
        state: "running",
        deadline: this.now() + this.runTimeoutMs,
        attempts: 0,
        candidateIds: [],
        presentedCandidateId: null,
        failure: null,
        createdAt: this.now(),
        finishedAt: null,
      };
      s.runs[run.id] = run;
      return run;
    });
    const ac = new AbortController();
    this.aborts.set(run.id, ac);
    this.timers.set(run.id, setTimeout(() => this.expire(run.id), Math.max(0, run.deadline - this.now())));
    const p = this.execute(run.id, base?.body ?? null, ac.signal).finally(() => {
      this.aborts.delete(run.id);
      clearTimeout(this.timers.get(run.id));
      this.timers.delete(run.id);
      this.inflight.delete(run.id);
    });
    this.inflight.set(run.id, p);
    return structuredClone(run);
  }

  /** 実行が受付時の状態のままで、結果を採用できるか。 */
  private live(runId: string): boolean {
    const r = this.o.store.runs[runId];
    if (!r || r.state !== "running") return false;
    if (this.now() > r.deadline) {
      this.expire(runId);
      return false;
    }
    return true;
  }

  private expire(runId: string) {
    const r = this.o.store.runs[runId];
    if (!r || r.state !== "running") return;
    this.o.store.tx(() => {
      r.state = "expired";
      r.finishedAt = this.now();
    });
    this.aborts.get(runId)?.abort();
  }

  cancelRun(owner: string, runId: string): Run {
    const r = this.o.store.runs[runId];
    if (!r || !this.sees(r.owner, owner)) throw new ServiceError(404, "実行が見つからない");
    if (r.state === "running" || r.state === "presented")
      this.o.store.tx(() => {
        r.state = "cancelled";
        r.finishedAt = this.now();
      });
    this.aborts.get(runId)?.abort();
    return structuredClone(r);
  }

  getRun(owner: string, runId: string) {
    const r = this.o.store.runs[runId];
    if (!r || !this.sees(r.owner, owner)) throw new ServiceError(404, "実行が見つからない");
    const cands = r.candidateIds.map((c) => this.candidateView(this.o.store.candidates[c]));
    return { ...structuredClone(r), candidates: cands };
  }

  private candidateView(c: Candidate) {
    const v = c.verificationId ? this.o.store.verifications[c.verificationId] : null;
    return {
      id: c.id,
      runId: c.runId,
      artworkId: c.artworkId,
      baseRevision: c.baseRevision,
      attempt: c.attempt,
      title: c.body.title,
      digest: c.digest,
      changes: c.changes,
      unconfirmed: c.unconfirmed,
      reply: c.reply,
      verification: v ? { id: v.id, requiredPassed: v.requiredPassed, checks: v.checks, failedAt: v.failedAt ?? null, environment: v.environment } : null,
    };
  }

  // ---- 生成・検査・観測 ----
  private async execute(runId: string, base: ArtworkBody | null, signal: AbortSignal) {
    const run = this.o.store.runs[runId];
    let previous: ArtworkBody | null = null;
    let previousDigest: string | null = null;
    let observations: Observation[] = [];
    for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      if (!this.live(runId)) return;
      const input: GenerationInput = {
        request: run.request.message,
        conversation: run.request.conversation,
        base,
        baseDigest: run.baseDigest,
        contract: this.o.contract,
        datasets: [...this.datasets.values()].map((d) => ({ ref: d.ref, description: d.description })),
        attempt,
        previous,
        previousDigest,
        observations,
      };
      let out;
      try {
        out = await this.o.model.generate(input, signal);
      } catch (e) {
        if (!this.live(runId)) return;
        this.finish(runId, "failed", "生成に失敗: " + (e as Error).message);
        return;
      }
      if (!this.live(runId)) return; // 取消・期限切れ・撤回後に届いた結果は採用しない
      this.o.store.tx(() => {
        run.attempts = attempt + 1;
      });
      const contract = checkArtwork(out.body);
      const digest = contract.ok ? await artworkDigest(out.body) : "sha256:invalid";
      const candidate: Candidate = {
        id: id("c_"),
        runId,
        owner: run.owner,
        artworkId: run.artworkId,
        baseRevision: run.baseRevision,
        generation: run.generation,
        attempt,
        body: structuredClone(out.body),
        digest,
        changes: String(out.changes ?? "").slice(0, 2000),
        unconfirmed: (out.unconfirmed ?? []).map(String).slice(0, 20),
        reply: String(out.reply ?? "").slice(0, 2000),
        verificationId: null,
        createdAt: this.now(),
      };
      let verification: Verification;
      if (!contract.ok) {
        verification = this.makeVerification(digest, null, "none", [{ id: "contract", level: "contract", pass: false, detail: contract.errors.join(" / ") }]);
        observations = contract.errors.map((m) => ({ kind: "contract" as const, message: m }));
      } else {
        const data = this.datasetFor(out.body);
        if (out.body.dataRef && !this.datasets.has(out.body.dataRef)) {
          verification = this.makeVerification(digest, null, "none", [{ id: "contract", level: "contract", pass: false, detail: "未登録の dataRef" }]);
          observations = [{ kind: "contract", message: `未登録の dataRef: ${out.body.dataRef}` }];
        } else {
          let obs;
          try {
            obs = await this.o.observer.observe(out.body, data, signal);
          } catch (e) {
            if (!this.live(runId)) return;
            this.finish(runId, "failed", "観測に失敗: " + (e as Error).message);
            return;
          }
          if (!this.live(runId)) return;
          const dataDigest = data === null ? null : "sha256:" + (await sha256Hex(JSON.stringify(data)));
          verification = this.makeVerification(digest, dataDigest, obs.environment, [{ id: "contract", level: "contract", pass: true }, ...obs.checks]);
          observations = obs.observations;
        }
      }
      candidate.verificationId = verification.id;
      this.o.store.tx((s) => {
        s.verifications[verification.id] = verification;
        s.candidates[candidate.id] = candidate;
        run.candidateIds.push(candidate.id);
        if (verification.requiredPassed) {
          run.presentedCandidateId = candidate.id;
          run.state = "presented";
          run.finishedAt = this.now();
        }
      });
      if (verification.requiredPassed) return;
      previous = out.body;
      previousDigest = digest;
    }
    this.finish(runId, "failed", "修正の上限（初回＋2 回）に達した");
  }

  private finish(runId: string, state: "failed", failure: string) {
    const r = this.o.store.runs[runId];
    if (!r || r.state !== "running") return;
    this.o.store.tx(() => {
      r.state = state;
      r.failure = failure;
      r.finishedAt = this.now();
    });
  }

  private makeVerification(digest: string, dataDigest: string | null, environment: string, checks: Verification["checks"]): Verification {
    const required = checks.filter((c) => c.level !== "matched");
    const failed = required.find((c) => !c.pass);
    const hasLevels = ["contract", "loaded", "operated"].every((l) => checks.some((c) => c.level === l));
    return {
      id: id("v_"),
      digest,
      suite: this.o.observer.suite,
      environment,
      dataDigest,
      checks,
      requiredPassed: hasLevels && !failed,
      failedAt: failed?.id,
      createdAt: this.now(),
    };
  }

  // ---- 保存 ----
  async save(owner: string, candidateId: string, req: { expectedRevision: number; idempotencyKey: string }) {
    const key = String(req.idempotencyKey ?? "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new ServiceError(400, "idempotencyKey の形式");
    const fingerprint = `save:${candidateId}:${req.expectedRevision}`;
    const prior = this.o.store.receipt(owner, key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ServiceError(409, "同じ受領キーで別の操作", { code: "idempotency-mismatch" });
      return { status: prior.status, result: prior.result, replay: true };
    }
    const c = this.o.store.candidates[candidateId];
    if (!c || !this.sees(c.owner, owner)) throw new ServiceError(404, "候補が見つからない");
    const run = this.o.store.runs[c.runId];
    if (!run || run.state !== "presented" || run.presentedCandidateId !== c.id)
      throw new ServiceError(409, "この候補は採用できない状態", { code: "run-" + (run?.state ?? "missing") });
    const v = c.verificationId ? this.o.store.verifications[c.verificationId] : null;
    const recomputed = await artworkDigest(c.body);
    if (!v || !v.requiredPassed) throw new ServiceError(409, "必須の検証に合格していない", { code: "unverified" });
    if (v.digest !== c.digest || recomputed !== c.digest) throw new ServiceError(409, "検証した digest と一致しない", { code: "digest-mismatch" });
    const art = this.o.store.artworks[c.artworkId];
    if (art && !this.sees(art.owner, owner)) throw new ServiceError(404, "候補が見つからない");
    const current = art?.currentRevision ?? 0;
    if (req.expectedRevision !== current || c.baseRevision !== current) {
      // 競合。候補は残し、差分の確認に戻す
      throw new ServiceError(409, "現在版が変わっている", { code: "conflict", currentRevision: current, candidateBase: c.baseRevision });
    }
    const result = this.o.store.tx((s) => {
      const t = this.now();
      let a = s.artworks[c.artworkId];
      if (!a) {
        a = { id: c.artworkId, owner, title: c.body.title, currentRevision: 0, createdAt: t, updatedAt: t };
        s.artworks[a.id] = a;
      }
      const rev: Revision = {
        artworkId: a.id,
        revision: a.currentRevision + 1,
        parent: a.currentRevision || null,
        body: structuredClone(c.body),
        digest: c.digest,
        verificationId: v.id,
        candidateId: c.id,
        restoredFrom: null,
        createdAt: t,
      };
      this.o.store.pushRevision(s, rev);
      a.currentRevision = rev.revision;
      a.title = c.body.title;
      a.updatedAt = t;
      const result = { artworkId: a.id, revision: rev.revision, digest: rev.digest };
      this.o.store.putReceipt(s, { key, owner, fingerprint, status: 200, result });
      return result;
    });
    return { status: 200, result, replay: false };
  }

  // ---- 復元 ----
  async restore(owner: string, artworkId: string, req: { revision: number; expectedRevision: number; idempotencyKey: string }) {
    const key = String(req.idempotencyKey ?? "");
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new ServiceError(400, "idempotencyKey の形式");
    const fingerprint = `restore:${artworkId}:${req.revision}:${req.expectedRevision}`;
    const prior = this.o.store.receipt(owner, key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ServiceError(409, "同じ受領キーで別の操作", { code: "idempotency-mismatch" });
      return { status: prior.status, result: prior.result, replay: true };
    }
    const a = this.ownArtwork(owner, artworkId);
    const src = this.o.store.revisionsOf(a.id).find((r) => r.revision === req.revision);
    if (!src) throw new ServiceError(404, "版が見つからない");
    if (req.expectedRevision !== a.currentRevision) throw new ServiceError(409, "現在版が変わっている", { code: "conflict", currentRevision: a.currentRevision });
    if ((await artworkDigest(src.body)) !== src.digest) throw new ServiceError(409, "保存版の digest が一致しない", { code: "digest-mismatch" });
    const result = this.o.store.tx((s) => {
      const t = this.now();
      const rev: Revision = {
        artworkId: a.id,
        revision: a.currentRevision + 1,
        parent: a.currentRevision,
        body: structuredClone(src.body),
        digest: src.digest,
        verificationId: src.verificationId,
        candidateId: null,
        restoredFrom: src.revision,
        createdAt: t,
      };
      this.o.store.pushRevision(s, rev);
      a.currentRevision = rev.revision;
      a.title = src.body.title;
      a.updatedAt = t;
      const result = { artworkId: a.id, revision: rev.revision, digest: rev.digest, restoredFrom: src.revision };
      this.o.store.putReceipt(s, { key, owner, fingerprint, status: 200, result });
      return result;
    });
    return { status: 200, result, replay: false };
  }

  // ---- 参照 ----
  listArtworks(owner: string) {
    return Object.values(this.o.store.artworks)
      .filter((a) => this.sees(a.owner, owner))
      .sort((x, y) => y.updatedAt - x.updatedAt)
      .map((a) => ({ id: a.id, title: a.title, currentRevision: a.currentRevision, updatedAt: a.updatedAt }));
  }

  getArtwork(owner: string, artworkId: string) {
    const a = this.ownArtwork(owner, artworkId);
    return {
      ...a,
      revisions: this.o.store.revisionsOf(a.id).map((r) => ({ revision: r.revision, parent: r.parent, digest: r.digest, restoredFrom: r.restoredFrom, title: r.body.title, createdAt: r.createdAt })),
    };
  }

  /** プレビュー対象の実体を解決する。所有者を照合し、保存版か提示中の候補だけを返す。 */
  resolvePreview(owner: string, src: { candidateId?: string; artworkId?: string; revision?: number }): { body: ArtworkBody; data: unknown } {
    if (src.candidateId) {
      const c = this.o.store.candidates[src.candidateId];
      if (!c || !this.sees(c.owner, owner)) throw new ServiceError(404, "候補が見つからない");
      const v = c.verificationId ? this.o.store.verifications[c.verificationId] : null;
      // 契約の検査と起動を通った候補だけをプレビューできる
      if (!v || !v.checks.some((k) => k.level === "loaded" && k.pass)) throw new ServiceError(409, "起動を確認していない候補", { code: "not-loaded" });
      return { body: c.body, data: this.datasetFor(c.body) };
    }
    if (src.artworkId) {
      const a = this.ownArtwork(owner, src.artworkId);
      const rev = this.o.store.revisionsOf(a.id).find((r) => r.revision === (src.revision ?? a.currentRevision));
      if (!rev) throw new ServiceError(404, "版が見つからない");
      return { body: rev.body, data: this.datasetFor(rev.body) };
    }
    throw new ServiceError(400, "プレビュー対象がない");
  }

  async drain() {
    await Promise.allSettled([...this.inflight.values()]);
  }
}
