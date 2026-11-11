// 直接生成の実行器（評価担当）。1 回の反復を順に実行し、判定は制作の完了後に別途行う。
//   bun eval/p3/run.ts --cond D --run-dir /workspace/canvas_p3/D-r<k> --host-port <port> [--tasks ID,ID]
//   bun eval/p3/run.ts --suite general --cond D --run-dir /workspace/canvas_general/D-r<k> --host-port <port>   汎用課題 general-v1（docs/eval/general-v1.md）
//   bun eval/p3/run.ts --suite render --cond D --run-dir /workspace/canvas_render/D-r<k> --host-port <port>    描画方式の計測基板 render-v1（docs/eval/render-v1.md）
//   bun eval/p3/run.ts --suite <suite> --cond A --review probes|judge|full --run-dir <root>/A-r<k> --host-port <port>   条件 A（宣言つきの制作担当＋検証、docs/eval/agent-v1.md）
// 制作は製品と同じ CanvasService（契約検査・ホスト観測・修正 2 回まで・保存）を通す。制作担当は run-dir の solo/ のファイル応答で答える。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { artworkDigest, type ArtworkBody } from "../../src/contract/artwork";
import type { GenerationInput, GenerationOutput, ModelPort } from "../../src/core/model-port";
import { HostReviewer } from "../../src/core/host-reviewer";
import { loadMakerSkill, MAKER_SKILL_PATH } from "../../src/core/maker-skill";
import { OBSERVER_SUITE, PlaywrightObserver } from "../../src/core/observer";
import { PlaywrightProber, PROBE_SUITE } from "../../src/core/probes";
import { PromptEvaluator } from "../../src/core/prompt-evaluator";
import { PromptMaker } from "../../src/core/prompt-maker";
import type { ReplayRecord, ReviewerPort, ReviewInput, ReviewMode, ReviewOutcome } from "../../src/core/review";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import type { Turn } from "../../src/core/types";
import { startApp } from "../../src/server/app";
import type { HttpChannelOptions } from "../../src/server/http-channel";
import { FileChannel } from "./channel";
import { LiveChannel, LIVE_MAX_OUTPUT, LIVE_TASK_MS } from "./live-channel";
import { DirectModel, directSystem } from "./cond-d";
import { createHash } from "node:crypto";
import { GENERAL_DATASETS, GENERAL_TASKS } from "../general/suite";
import { RENDER_TASKS } from "../render/suite";
import { REPLAY_TASKS } from "../replay/suite";

const ROOT = resolve(import.meta.dir, "../..");
const EVAL = resolve(import.meta.dir, "..");
export const RUN_TIMEOUT_MS = 6 * 3600_000; // 応答者の待ちを含むため製品の 180 秒は当てはめない（docs/p3-eval.md）
const SUBMISSIONS_PER_TASK = 6; // plan.md §3.2

export interface Task {
  id: string;
  group: "new" | "modify" | "repair" | "nongame";
  seed: number;
  base?: string;
  baseTitle?: string;
  dataRef?: string;
  turns: string[];
  start?: ArtworkBody;
}
export const TASKS = (JSON.parse(readFileSync(join(EVAL, "tasks/heldout.json"), "utf8")) as { tasks: Task[] }).tasks;
// P2 の実行器（eval/runner.ts）と同じ登録データ
export const DATASETS = [{ ref: "synthetic-sensors", description: "合成センサー値（温度・湿度・気圧の 3 系列×25 点。groups[{name,color}], points[{group,x,y}]、x・y は 0〜100）", data: JSON.parse(readFileSync(join(EVAL, "data/synthetic-sensors.json"), "utf8")) }];
const baseBody = (t: Task): ArtworkBody | null => t.start ?? (t.base ? { title: t.baseTitle!, entry: readFileSync(join(EVAL, t.base), "utf8"), ...(t.dataRef ? { dataRef: t.dataRef } : {}) } : null);
const SEED_REQUEST = "[評価の準備] 元作品を版 1 にする";

/** 元作品を版 1 として置く前処理（P2 と同じ。制作担当の推論には数えない）。 */
class SeedingModel implements ModelPort {
  readonly label: string;
  constructor(private inner: ModelPort, private seed: ArtworkBody | null) {
    this.label = inner.label;
  }
  generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput> {
    if (input.request === SEED_REQUEST && this.seed) return Promise.resolve({ body: this.seed, changes: "元作品", unconfirmed: [], reply: "" });
    return this.inner.generate(input, signal);
  }
}

/** 前処理（元作品を版 1 にする実行）では検証しない。修復の課題の元作品はわざと壊してあり、検証すると直しの生成が走るため。 */
class SeedSkippingReviewer implements ReviewerPort {
  readonly suite: string;
  constructor(private inner: ReviewerPort, private canJudge?: () => boolean) {
    this.suite = inner.suite;
  }
  review(input: ReviewInput, signal: AbortSignal): Promise<ReviewOutcome> {
    if (input.request === SEED_REQUEST) return Promise.resolve({ suite: this.suite, environment: "none", checks: [], findings: [], verdict: null, evaluatorCalls: 0, ms: 0, error: null });
    if (input.replay && this.canJudge && !this.canJudge()) {
      return this.inner.review({ ...input, replay: { ...input.replay, observeOnly: true } }, signal);
    }
    return this.inner.review(input, signal);
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}

export interface ReviewRecord {
  attempt: number;
  blocking: number;
  findings: { severity: string; id: string; message: string }[];
  evaluatorCalls: number;
  ms: number;
  error: string | null;
  replay?: ReplayRecord;
  digest?: string;
}
export interface TurnRecord {
  saved?: ArtworkBody;
  request: string;
  state: string;
  submissions: number;
  failure: string | null;
  hostMs: number;
  wallMs: number;
  calls: number;
  smokeFailures: string[];
  /** そのターンの検証担当の推論の回数。 */
  evalCalls: number;
  /** 候補ごとの検証の要約（検証しなかった候補は含めない）。 */
  reviews: ReviewRecord[];
}
export interface TaskRecord {
  cond: string;
  run: string;
  task: string;
  group: Task["group"];
  presented: boolean;
  submissions: number;
  calls: number;
  turns: TurnRecord[];
  final: ArtworkBody | null;
  finalDigest: string | null;
  error: string | null;
  /** 課題全体の検証担当の推論の回数。 */
  evalCalls: number;
  /** 最後に保存した候補の検証の要約。検証なしなら null。 */
  finalReview: { blocking: number; verdicts: { requirement: string; verdict: string }[]; error: string | null } | null;
}

async function main() {
  const { values } = parseArgs({ options: {
    cond: { type: "string" }, review: { type: "string" }, "run-dir": { type: "string" },
    "host-port": { type: "string" }, tasks: { type: "string" }, suite: { type: "string" },
    "live-config": { type: "string" }, "max-calls": { type: "string" },
    "live-evaluator-config": { type: "string" }, "max-eval-calls": { type: "string" },
    "maker-skill": { type: "string" },
  } });
  const suite = values.suite ?? "heldout";
  if (!["heldout", "general", "render", "replay"].includes(suite)) throw new Error("--suite heldout|general|render|replay");
  const cond = values.cond;
  if (cond !== "D" && cond !== "A") throw new Error("--cond D（直接生成）か --cond A（宣言つきの制作担当＋検証）を指定してください");
  if (cond !== "D" && values["maker-skill"]) throw new Error("--maker-skill は条件 D で指定してください");
  const makerSkillPath = values["maker-skill"] ?? MAKER_SKILL_PATH;
  const directPromptSystem = cond === "D" ? directSystem(loadMakerSkill(makerSkillPath)) : undefined;
  if (cond === "D" && values.review !== undefined) throw new Error("--review は条件 A だけで指定できる");
  const review = (cond === "A" ? (values.review ?? "full") : "off") as ReviewMode;
  if (cond === "A" && !["off", "probes", "judge", "full", "replay"].includes(review)) throw new Error("--review off|probes|judge|full|replay");
  const live = values["live-config"] ? JSON.parse(readFileSync(values["live-config"], "utf8")) as HttpChannelOptions : null;
  const liveEvaluator = values["live-evaluator-config"] ? JSON.parse(readFileSync(values["live-evaluator-config"], "utf8")) as HttpChannelOptions : null;
  const maxCalls = Number(values["max-calls"]);
  const maxEvalCalls = Number(values["max-eval-calls"]);
  if (live && (!Number.isSafeInteger(maxCalls) || maxCalls < 1)) throw new Error("実モデルの実行には --max-calls が必要");
  const useEvaluator = review === "judge" || review === "full" || review === "replay";
  if (live && useEvaluator && !liveEvaluator) throw new Error("実モデルの検証担当には --live-evaluator-config が必要");
  if (liveEvaluator && (!live || !useEvaluator || !Number.isSafeInteger(maxEvalCalls) || maxEvalCalls < 1))
    throw new Error("実モデルの検証担当には --live-config と正の --max-eval-calls が必要");
  // render-v1 はすべて新規（元作品・登録データなし）。参照の作品の libraries は制作担当に渡さない
  const SUITE_TASKS: Task[] =
    suite === "replay" ? REPLAY_TASKS : suite === "general" ? GENERAL_TASKS.map(({ fixed: _f, ...t }) => t) : suite === "render" ? RENDER_TASKS.map((t) => ({ id: t.id, group: "new" as const, seed: t.seed, turns: t.turns })) : TASKS;
  const SUITE_DATASETS = suite === "general" ? GENERAL_DATASETS : suite === "render" || suite === "replay" ? [] : DATASETS;
  const runDir = resolve(values["run-dir"]!);
  const runName = runDir.split("/").pop()!;
  const port = Number(values["host-port"]);
  const hostDir = join(runDir, "host");
  const usage = join(hostDir, "usage.jsonl");
  const only = values.tasks ? new Set(values.tasks.split(",")) : null;
  const tasks = SUITE_TASKS.filter((t) => !only || only.has(t.id));
  if (live && (existsSync(join(hostDir, "run.json")) || existsSync(usage))) throw new Error("実モデルの実行には新しい --run-dir が必要");
  const gen = live
    ? new LiveChannel({ ...live, maxCompletionTokens: LIVE_MAX_OUTPUT, store: false }, usage, maxCalls)
    : new FileChannel(join(runDir, "solo/gen"), "gen", usage, cond);
  // 検証担当は制作担当と別の要求・使用量で動く。代行の場合は応答場所も別にする。
  const ev = liveEvaluator
    ? new LiveChannel({ ...liveEvaluator, maxCompletionTokens: LIVE_MAX_OUTPUT, store: false }, join(hostDir, "evaluator-usage.jsonl"), maxEvalCalls, review === "replay" ? { task: 1, turn: 1 } : { task: 12, turn: 6 })
    : useEvaluator ? new FileChannel(join(runDir, "solo/eval"), "eval", usage, cond) : null;
  mkdirSync(join(hostDir, "final"), { recursive: true });

  const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
  const contract = readFileSync(join(ROOT, "docs/artwork-contract-v1.md"), "utf8");
  const resultsFile = join(hostDir, "results.json");
  const done: TaskRecord[] = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")).records : [];
  const sha = (f: string) => "sha256:" + createHash("sha256").update(readFileSync(join(ROOT, f))).digest("hex");
  const liveMetadata = live && {
    model: live.model, reasoningEffort: live.reasoningEffort, format: live.format ?? "json",
    maxCalls, maxCompletionTokens: LIVE_MAX_OUTPUT, taskTimeLimitMs: LIVE_TASK_MS,
    ...(liveEvaluator ? { evaluatorModel: liveEvaluator.model, evaluatorReasoningEffort: liveEvaluator.reasoningEffort, maxEvalCalls } : {}),
  };
  const makerSkillDigest = "sha256:" + createHash("sha256").update(readFileSync(makerSkillPath)).digest("hex");
  writeFileSync(join(hostDir, "run.json"), JSON.stringify({ suite, observer: OBSERVER_SUITE, contractDigest: sha("docs/artwork-contract-v1.md"), makerSkillDigest, cond, review, probe: PROBE_SUITE, evaluatorSkillDigest: sha("docs/evaluator-skill.md"), makerPitfallsDigest: sha("docs/maker-pitfalls.md"), run: runName, startedAt: new Date().toISOString(), tasks: tasks.map((t) => t.id), ...(liveMetadata ?? { stand_in: "Grok Bot responder（Luna／Haiku ではない）" }) }, null, 2));

  try {
    for (const t of tasks) {
      if (done.some((r) => r.task === t.id)) continue; // 再開時は済んだ課題を飛ばす
      const observer = new PlaywrightObserver(app.hostOrigin, (b) => app.tokens.issue(b));
      const model: ModelPort = cond === "A" ? new PromptMaker(gen, { label: live?.model ?? "agent-maker(stand-in)" }) : new DirectModel(gen, directPromptSystem, live?.model);
      const reviewer =
        review !== "off" ? new SeedSkippingReviewer(
          new HostReviewer(new PlaywrightProber(app.hostOrigin, (b) => app.tokens.issue(b)), ev ? new PromptEvaluator(ev, { label: liveEvaluator?.model ?? "agent-evaluator(stand-in)" }) : null),
          review === "replay" && ev instanceof LiveChannel ? () => ev.canCallInTask() : undefined,
        ) : null;
      const svc = new CanvasService({
        store: new Store(null),
        model: new SeedingModel(model, baseBody(t)),
        observer,
        contract,
        datasets: SUITE_DATASETS,
        runTimeoutMs: live ? LIVE_TASK_MS : RUN_TIMEOUT_MS,
        ...(reviewer ? { review: { reviewer, mode: review } } : {}),
      });
      const owner = "p3-owner", session = `p3-${runName}-${t.id}`;
      const rec: TaskRecord = { cond, run: runName, task: t.id, group: t.group, presented: false, submissions: 0, calls: 0, turns: [], final: null, finalDigest: null, error: null, evalCalls: 0, finalReview: null };
      let artworkId: string | null = null, revision = 0, n = 0;
      const key = () => `k_${runName}_${t.id.replace(/[^A-Za-z0-9]/g, "")}_${n++}`.slice(0, 64);
      gen.scope = { task: t.id, turn: null };
      if (ev) ev.scope = { task: t.id, turn: null };
      try {
        if (t.base || t.start) {
          const r = await svc.startRun(owner, session, { message: SEED_REQUEST });
          await svc.drain();
          const st = svc.getRun(owner, r.id);
          if (st.state !== "presented") throw new Error("元作品が観測に通らない: " + st.failure);
          const s = await svc.save(owner, st.presentedCandidateId!, { expectedRevision: 0, idempotencyKey: key() });
          artworkId = (s.result as { artworkId: string }).artworkId;
          revision = 1;
        }
        const conversation: Turn[] = [];
        const taskStart = performance.now();
        for (const [ti, turn] of t.turns.entries()) {
          gen.scope = { task: t.id, turn: ti };
          if (ev) ev.scope = { task: t.id, turn: ti };
          const w0 = gen.waitedMs + (ev?.waitedMs ?? 0), c0 = gen.calls, e0 = ev?.calls ?? 0;
          const t0 = performance.now();
          const r = await svc.startRun(owner, session, { message: turn, artworkId, conversation: [...conversation] });
          await svc.drain();
          const st = svc.getRun(owner, r.id);
          const wallMs = performance.now() - t0;
          const waited = gen.waitedMs + (ev?.waitedMs ?? 0) - w0; // 制作担当と検証担当の両方の待ちを引く
          const calls = gen.calls - c0;
          const evalCalls = (ev?.calls ?? 0) - e0;
          const submissions = st.attempts;
          rec.turns.push({
            request: turn,
            state: st.state,
            submissions,
            failure: st.failure,
            hostMs: Math.round(wallMs - waited),
            wallMs: Math.round(wallMs),
            calls,
            smokeFailures: st.candidates.flatMap((c) => (c.verification?.checks ?? []).filter((k) => !k.pass).map((k) => `${c.attempt}:${k.id}:${k.detail ?? ""}`.slice(0, 300))),
            evalCalls,
            reviews: st.candidates.flatMap((c) =>
              c.review
                ? [{ attempt: c.attempt, blocking: c.review.blocking, findings: c.review.findings.map((f) => ({ severity: f.severity, id: f.id, message: f.message.slice(0, 200) })), evaluatorCalls: c.review.evaluatorCalls, ms: c.review.ms, error: c.review.error, ...(c.review.replay ? { replay: c.review.replay, digest: c.digest } : {}) }]
                : [],
            ),
          });
          rec.submissions += submissions;
          rec.calls += calls;
          rec.evalCalls += evalCalls;
          conversation.push({ role: "user", text: turn });
          if (st.state !== "presented") break;
          const cand = st.candidates.find((c) => c.id === st.presentedCandidateId)!;
          const s = await svc.save(owner, cand.id, { expectedRevision: revision, idempotencyKey: key() });
          artworkId = (s.result as { artworkId: string }).artworkId;
          revision = (s.result as { revision: number }).revision;
          if (suite === "replay") rec.turns.at(-1)!.saved = svc.resolvePreview(owner, { artworkId }).body;
          rec.finalReview = cand.review ? { blocking: cand.review.blocking, verdicts: (cand.review.verdict?.verdicts ?? []).map((v) => ({ requirement: v.requirement, verdict: v.verdict })), error: cand.review.error } : null;
          conversation.push({ role: "assistant", text: cand.reply });
        }
        rec.presented = rec.turns.length === t.turns.length && rec.turns.every((x) => x.state === "presented");
        if (live && performance.now() - taskStart > LIVE_TASK_MS) {
          rec.presented = false;
          rec.error = "課題の時間上限を超えた";
        }
        if (rec.submissions > SUBMISSIONS_PER_TASK) {
          rec.presented = false;
          rec.error = `提出が ${SUBMISSIONS_PER_TASK} 回を超えた`;
        }
        if (rec.presented && artworkId) {
          rec.final = svc.resolvePreview(owner, { artworkId }).body;
          rec.finalDigest = await artworkDigest(rec.final);
        }
      } catch (e) {
        rec.error = (e as Error).message.slice(0, 500);
      } finally {
        // 観測器と検証（HostReviewer の観測室）は CanvasService.close が閉じる
        await svc.close();
      }
      done.push(rec);
      writeFileSync(join(hostDir, "final", `${t.id}.json`), JSON.stringify({ task: t.id, final: rec.final, finalDigest: rec.finalDigest }, null, 2));
      writeFileSync(resultsFile, JSON.stringify({ cond, run: runName, records: done }, null, 2));
      // 応答者への知らせはホスト観測の結果だけ（隠れた判定の結果は書かない）
      if (gen instanceof FileChannel) gen.notice("task-end", `課題が終わりました（ホスト観測：${rec.presented ? "全ターンで候補を提示・保存" : "候補を提示できずに終了"}）。次の要求を待ってください。`);
      console.log(`${t.id}: ${rec.presented ? "提示" : "未提示"} 提出 ${rec.submissions} 推論 ${rec.calls} ${rec.turns.map((x) => `${x.state}/${live ? x.wallMs : x.hostMs}ms`).join(" → ")}${rec.error ? " " + rec.error : ""}`);
    }
  } finally {
    app.stop();
  }
  writeFileSync(join(hostDir, "DONE"), new Date().toISOString());
  console.log("runner finished");
  process.exit(0);
}

if (import.meta.main) await main();
