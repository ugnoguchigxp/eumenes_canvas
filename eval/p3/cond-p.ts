// 条件 P：Pursuit。eumenes-pursuit の engine を host 契約（spec/host-contract-v1.md）の port で動かす。
// 1 ターン = 1 追求。作品の提出は道具 write_artwork（1 ターン 3 回まで、製品と同じ契約検査＋ホスト観測）。
// 受入条件はホスト観測の 3 段階だけ（隠れた判定は使わない）。終わったら作業領域の作品を製品の制作経路に渡す。
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtworkBody } from "../../src/contract/artwork";
import { sha256Hex } from "../../src/contract/artwork";
import type { GenerationInput, GenerationOutput, ModelPort } from "../../src/core/model-port";
import { ModelError } from "../../src/core/model-port";
import type { ObserverPort } from "../../src/core/observer";
import type { FileChannel } from "./channel";
import { describeChecks, smoke, type SmokeResult, type SubmissionBudget } from "./common";
import { pursuit, pursuitSqlite, pursuitZod } from "./deps";

type P = typeof pursuit;
type LedgerDb = Parameters<Parameters<import("/workspace/p3-deps/eumenes_pursuit/src/contracts/db.ts").PursuitStore["write"]>[0]>[0];

export const CONSULT_ANSWER = "利用者は不在です。依頼文と観測の範囲で判断してください。";
export const GOAL_MAX = 8000;
export const policyP3 = JSON.parse(readFileSync(join(import.meta.dir, "policy.p3.json"), "utf8"));

/** host の単一 writer の代わり（一時 DB・1 接続・callback はすべて transaction の中）。 */
export function openLedger(path: string) {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL)");
  for (const m of pursuitSqlite.migrations) {
    const sha = new Bun.CryptoHasher("sha256").update(m.sql).digest("hex");
    if (sha !== m.sha256) throw new Error(`migration_checksum:${m.id}`);
    if (db.query("SELECT 1 FROM schema_migrations WHERE id = ?").get(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.query("INSERT INTO schema_migrations (id, sha256) VALUES (?, ?)").run(m.id, m.sha256);
    }).immediate();
  }
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => T): Promise<T> => {
    const next = queue.then(op);
    queue = next.catch(() => undefined);
    return next;
  };
  const ledger = db as unknown as LedgerDb;
  return {
    write: <T>(op: (d: LedgerDb) => T) => serial(() => db.transaction(() => op(ledger)).immediate()),
    readSnapshot: <T>(op: (d: LedgerDb) => T) => serial(() => db.transaction(() => op(ledger)).deferred()),
    close: () => db.close(),
  };
}

/** ファイル応答の LlmPort。毎回新しい文脈。トークンは文字数÷4 の推定（3 条件で同じ式）。 */
export function fileLlm(ch: FileChannel, role: string): import("/workspace/p3-deps/eumenes_pursuit/src/contracts/ports.ts").LlmPort {
  return {
    async complete(request, signal) {
      const t0 = performance.now();
      const schema = pursuitZod.toJSONSchema(request.schema as never, { io: "input" });
      let text = "";
      const value = await ch.complete(
        { purpose: request.purpose, system: request.system, prompt: request.prompt, outputSchema: schema, maxOutputChars: Math.max(4 * request.maxOutputTokens, 131072) },
        (v) => {
          const r = request.schema.safeParse(v);
          text = JSON.stringify(v ?? null);
          return r.success ? { ok: true, value: r.data } : { ok: false, issues: r.error.issues };
        },
        signal,
      );
      return {
        value,
        model: `file:${role}`,
        inputTokens: Math.ceil((request.system.length + request.prompt.length) / 4),
        outputTokens: Math.ceil(text.length / 4),
        cacheReadTokens: 0,
        latencyMs: performance.now() - t0,
      };
    },
  };
}

interface Work {
  title: string;
  entry: string;
  dataRef?: string;
}

/** 作品 1 つだけの作業領域。 */
class ArtworkWorkspace {
  private checkpoints = new Map<string, Work>();
  private n = 0;
  constructor(public work: Work) {}
  async checkpoint() {
    const id = `cp${++this.n}`;
    this.checkpoints.set(id, structuredClone(this.work));
    return id;
  }
  async restore(id: string) {
    const w = this.checkpoints.get(id);
    if (!w) throw new Error("unknown_checkpoint");
    this.work = structuredClone(w);
  }
  async digest() {
    return "sha256:" + (await sha256Hex(JSON.stringify(this.work)));
  }
  async changesSince(id: string) {
    const w = this.checkpoints.get(id);
    if (!w) throw new Error("unknown_checkpoint");
    const same = JSON.stringify(w) === JSON.stringify(this.work);
    const a = w.entry.split("\n"), b = this.work.entry.split("\n");
    const count = new Map<string, number>();
    for (const l of a) count.set(l, (count.get(l) ?? 0) + 1);
    let common = 0;
    for (const l of b) if ((count.get(l) ?? 0) > 0) { common++; count.set(l, count.get(l)! - 1); }
    return { filesTouched: same ? [] : ["artwork.js"], filesCreated: same || w.entry ? [] : ["artwork.js"], linesChanged: same ? 0 : a.length + b.length - 2 * common, protectedTouched: [] };
  }
}

const ACCEPTANCE = [
  { id: "contract", text: "作品（title・entry、データを使うなら dataRef）が公開された実行契約の検査に通る。", method: "machine" as const },
  { id: "loaded", text: "ホストのブラウザ観測で作品が起動する（10 秒以内に ready になる）。", method: "machine" as const },
  { id: "operated", text: "ホストのブラウザ観測で、実行時エラーがなく、画面が単色でなく、時間の経過または一定の入力列（矢印・Space と 6×4 の格子点のクリック）で描画が変わる。", method: "machine" as const },
];

export interface PursuitTurnRecord {
  pursuitId: string;
  outcome: string | null;
  verified: boolean;
  reason: string;
  stats: unknown;
  writes: number;
  consultations: number;
  ledgerMs: number;
}

export class PursuitModel implements ModelPort {
  readonly label = "p3-pursuit-E1R(stand-in: Grok Bot responders)";
  records: PursuitTurnRecord[] = [];
  private seq = 0;
  constructor(
    private o: {
      gen: FileChannel;
      rev: FileChannel;
      observer: ObserverPort;
      datasets: Map<string, unknown>;
      budget: SubmissionBudget;
      ledgerPath: string;
      runName: string;
    },
  ) {}

  private goal(input: GenerationInput, includeBase: boolean) {
    const parts = [
      "利用者の依頼に沿って Canvas 2D の作品（ゲーム・可視化）を作る、または基準の作品を直す。作品は write_artwork で全文を書く（1 回ごとにホストが契約検査とブラウザ観測を行い、その結果を返す。書けるのはこの依頼で 3 回まで）。基準の作品があるときは、依頼された点だけを変え、それ以外の動き・見た目は保つ。",
      `## 利用者の依頼\n${input.request}`,
    ];
    if (input.conversation.length) parts.push(`## これまでの会話（古い順）\n${input.conversation.map((t) => `${t.role === "user" ? "利用者" : "制作担当"}: ${t.text}`).join("\n")}`);
    if (!input.base) parts.push("## 基準の作品\nなし（新規）。作業領域は空。");
    else if (includeBase) parts.push(`## 基準の作品（保存版。作業領域の初期内容）\n題名: ${input.base.title}${input.base.dataRef ? `\ndataRef: ${input.base.dataRef}` : ""}\n\`\`\`js\n${input.base.entry}\n\`\`\``);
    else parts.push(`## 基準の作品\n題名: ${input.base.title}。本文は長いので read_artwork で読む（作業領域の初期内容）。`);
    parts.push(`## 登録データ\n${input.datasets.length ? input.datasets.map((d) => `- ${d.ref}: ${d.description}`).join("\n") : "なし"}`);
    parts.push(`## 公開された実行契約\n${input.contract}`);
    return parts.join("\n\n");
  }

  async generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput> {
    if (input.attempt > 0) throw new ModelError("Pursuit の中で提出の上限を使い切った（製品の修正ループは使わない）");
    const ws = new ArtworkWorkspace(input.base ? { title: input.base.title, entry: input.base.entry, ...(input.base.dataRef ? { dataRef: input.base.dataRef } : {}) } : { title: "", entry: "" });
    const initialDigest = await ws.digest();
    let writes = 0;
    let lastSmoke: SmokeResult | null = null;
    const datasets = this.o.datasets;
    const observer = this.o.observer;
    const budget = this.o.budget;
    const tools = {
      list: () => [
        {
          name: "write_artwork",
          description:
            "作品の全文を作業領域に書き、ホストが契約検査とブラウザ観測（host-smoke/1：起動・実行時エラー・単色でないか・時間や一定の入力列で描画が変わるか）を行う。観測に通れば status ok、通らなければ status error（errorCode host_checks_failed）。output に各検査の合否と観測の文。この依頼で書けるのは 3 回まで（4 回目以降は submission_budget_exhausted）。",
          inputSchema: { type: "object", additionalProperties: false, required: ["title", "entry"], properties: { title: { type: "string", minLength: 1, maxLength: 80 }, entry: { type: "string", minLength: 1, description: "作品の JavaScript 全文（text field で渡せる）" }, dataRef: { type: "string" } } },
          sideEffect: "workspace" as const,
          permission: "canvas.artwork",
          textField: "entry",
          fingerprintFields: ["title", "entry", "dataRef"],
        },
        {
          name: "read_artwork",
          description: "作業領域の現在の作品（title・dataRef・entry の全文）を読む。",
          inputSchema: { type: "object", additionalProperties: false, properties: {} },
          sideEffect: "none" as const,
          readsWorkspace: true,
          readsBack: true,
          permission: "canvas.artwork",
        },
      ],
      async invoke(call: { tool: string; input: Record<string, unknown> }, sig: AbortSignal) {
        if (call.tool === "read_artwork") return { status: "ok" as const, output: { title: ws.work.title, dataRef: ws.work.dataRef ?? null, entry: ws.work.entry }, refs: [] };
        if (call.tool !== "write_artwork") return { status: "error" as const, output: { message: "unknown tool" }, errorCode: "unknown_tool", refs: [] };
        const i = call.input;
        if (typeof i.title !== "string" || typeof i.entry !== "string" || !i.entry.trim()) return { status: "error" as const, output: { message: "title と entry が必要" }, errorCode: "invalid_input", refs: [] };
        if (!budget.take()) return { status: "error" as const, output: { message: "この依頼で書ける回数（3 回）を使い切った" }, errorCode: "submission_budget_exhausted", refs: [] };
        writes++;
        ws.work = { title: i.title, entry: i.entry, ...(typeof i.dataRef === "string" && i.dataRef ? { dataRef: i.dataRef } : {}) };
        const r = await smoke(observer, ws.work as ArtworkBody, datasets, sig);
        lastSmoke = r;
        const output = { requiredPassed: r.requiredPassed, checks: describeChecks(r), observations: r.observations.map((o) => `${o.kind}: ${o.message}`) };
        return r.requiredPassed ? { status: "ok" as const, output, refs: [] } : { status: "error" as const, output, errorCode: "host_checks_failed", refs: [] };
      },
    };
    const acceptance = {
      async verify(sig: AbortSignal) {
        if (!ws.work.entry.trim()) return ACCEPTANCE.map((a) => ({ id: a.id, passed: false, evidence: "作品がまだない" }));
        const r = await smoke(observer, ws.work as ArtworkBody, datasets, sig);
        const lv = (l: string) => r.checks.filter((k) => k.level === l);
        return ACCEPTANCE.map((a) => {
          const ks = lv(a.id);
          return { id: a.id, passed: ks.length > 0 && ks.every((k) => k.pass), evidence: (ks.map((k) => `${k.id}=${k.pass ? "合格" : "不合格"}${k.detail ? `（${String(k.detail).slice(0, 200)}）` : ""}`).join(", ") || "未検査（前の段階で不合格）").slice(0, 500) };
        });
      },
    };
    const store = openLedger(this.o.ledgerPath);
    const engine = pursuit.createPursuitEngine({
      store,
      clock: { now: () => Date.now() },
      ids: { next: (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(this.seq++).toString(36)}_${crypto.randomUUID().slice(0, 8)}` },
      generator: fileLlm(this.o.gen, "gen"),
      reviewer: fileLlm(this.o.rev, "rev"),
      judge: null,
      onWarning: (code: string, detail: unknown) => console.warn(`[pursuit warn] ${code}`, JSON.stringify(detail).slice(0, 300)),
    } as never);
    let goal = this.goal(input, true);
    if (goal.length > GOAL_MAX) goal = this.goal(input, false);
    const t0 = performance.now();
    const waited0 = this.o.gen.waitedMs + this.o.rev.waitedMs;
    const started = await engine.start(
      {
        goal,
        acceptance: ACCEPTANCE,
        grant: ["canvas.artwork"],
        policy: policyP3,
        conditions: {
          rules: true,
          judge: false,
          review: true,
          questionSet: { id: pursuit.pursuitGuardsV1.id, version: pursuit.pursuitGuardsV1.version },
          adapter: null,
          language: "ja",
          findings: "verified",
          strategyChange: "free",
          selfCheck: "parts",
          verifyOn: "claim",
          prediction: "falsifiable",
          completionCheck: "acceptance",
          rollback: "notify",
          verdictLabel: "refutation",
          claimFeedback: "verdict",
          attemptCount: "mutating",
        },
        goalRef: null,
        label: null,
      },
      `${this.o.runName}:${crypto.randomUUID()}`,
    );
    const id = started.pursuitId;
    const runtime = { tools, workspace: ws, acceptance } as never;
    let consultations = 0;
    try {
      for (let i = 0; i < 1000; i++) {
        const step = await engine.step(id, runtime, signal);
        if (step.done) break;
        if (step.status === "awaiting_consultation") {
          const view = (await engine.view(id))!;
          const open = view.consultations.find((c: { answer: unknown }) => c.answer === null) as { id: string } | undefined;
          consultations = view.consultations.length;
          if (consultations > 3) {
            await engine.cancel(id, "相談が3回を超えました", runtime, signal);
            break;
          }
          if (open) await engine.answer(id, open.id, CONSULT_ANSWER);
        }
      }
    } finally {
      const view = await engine.view(id);
      const rep = view?.report ?? null;
      this.records.push({
        pursuitId: id,
        outcome: rep?.outcome ?? view?.status ?? null,
        verified: !!rep?.verified,
        reason: String(rep?.reason ?? "").slice(0, 500),
        stats: rep?.stats ?? null,
        writes,
        consultations,
        ledgerMs: Math.round(performance.now() - t0 - (this.o.gen.waitedMs + this.o.rev.waitedMs - waited0)),
      });
      store.close();
    }
    if ((await ws.digest()) === initialDigest || !ws.work.entry.trim()) throw new ModelError("Pursuit が作品を書かずに終わった");
    void lastSmoke;
    // Pursuit には利用者への返答が無い。報告の理由（制作担当が書いた文）をそのまま返答・変更内容に使う
    const reason = this.records.at(-1)!.reason;
    return { body: ws.work as ArtworkBody, changes: reason, unconfirmed: [], reply: reason };
  }
}
