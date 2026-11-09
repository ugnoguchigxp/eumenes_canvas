// P3 の実行器（評価担当）。1 つの条件・1 回の反復を、13 課題について順に行う。判定はしない（grade.ts で全条件の制作が終わってから行う）。
//   bun eval/p3/run.ts --cond D|C|P --run-dir /workspace/canvas_p3/<cond>-r<k> --host-port <port> [--tasks ID,ID]
// 制作は製品と同じ CanvasService（契約検査・ホスト観測・修正 2 回まで・保存）を通す。制作担当は run-dir の solo/ のファイル応答で答える。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { artworkDigest, type ArtworkBody } from "../../src/contract/artwork";
import type { GenerationInput, GenerationOutput, ModelPort } from "../../src/core/model-port";
import { PlaywrightObserver } from "../../src/core/observer";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import type { Turn } from "../../src/core/types";
import { startApp } from "../../src/server/app";
import { FileChannel } from "./channel";
import { CollaborationModel } from "./cond-c";
import { DirectModel } from "./cond-d";
import { PursuitModel } from "./cond-p";
import { SUBMISSIONS_PER_TASK, SubmissionBudget } from "./common";

const ROOT = resolve(import.meta.dir, "../..");
const EVAL = resolve(import.meta.dir, "..");
export const RUN_TIMEOUT_MS = 6 * 3600_000; // 応答者の待ちを含むため製品の 180 秒は当てはめない（docs/p3-eval.md）

export interface Task {
  id: string;
  group: "new" | "modify" | "repair" | "nongame";
  seed: number;
  base?: string;
  baseTitle?: string;
  dataRef?: string;
  turns: string[];
}
export const TASKS = (JSON.parse(readFileSync(join(EVAL, "tasks/heldout.json"), "utf8")) as { tasks: Task[] }).tasks;
// P2 の実行器（eval/runner.ts）と同じ登録データ
export const DATASETS = [{ ref: "synthetic-sensors", description: "合成センサー値（温度・湿度・気圧の 3 系列×25 点。groups[{name,color}], points[{group,x,y}]、x・y は 0〜100）", data: JSON.parse(readFileSync(join(EVAL, "data/synthetic-sensors.json"), "utf8")) }];
const baseBody = (t: Task): ArtworkBody | null => (t.base ? { title: t.baseTitle!, entry: readFileSync(join(EVAL, t.base), "utf8"), ...(t.dataRef ? { dataRef: t.dataRef } : {}) } : null);
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

export interface TurnRecord {
  request: string;
  state: string;
  submissions: number;
  failure: string | null;
  hostMs: number;
  wallMs: number;
  calls: number;
  smokeFailures: string[];
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
  pursuit?: unknown;
}

async function main() {
  const { values } = parseArgs({ options: { cond: { type: "string" }, "run-dir": { type: "string" }, "host-port": { type: "string" }, tasks: { type: "string" } } });
  const cond = values.cond as "D" | "C" | "P";
  if (!["D", "C", "P"].includes(cond)) throw new Error("--cond D|C|P");
  const runDir = resolve(values["run-dir"]!);
  const runName = runDir.split("/").pop()!;
  const port = Number(values["host-port"]);
  const hostDir = join(runDir, "host");
  mkdirSync(join(hostDir, "final"), { recursive: true });
  const usage = join(hostDir, "usage.jsonl");
  const only = values.tasks ? new Set(values.tasks.split(",")) : null;
  const tasks = TASKS.filter((t) => !only || only.has(t.id));

  const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
  const contract = readFileSync(join(ROOT, "docs/artwork-contract-v1.md"), "utf8");
  const datasets = new Map(DATASETS.map((d) => [d.ref, d.data]));
  const gen = new FileChannel(join(runDir, "solo/gen"), "gen", usage, cond);
  const rev = cond === "P" ? new FileChannel(join(runDir, "solo/rev"), "rev", usage, cond) : null;
  const channels = [gen, ...(rev ? [rev] : [])];
  const resultsFile = join(hostDir, "results.json");
  const done: TaskRecord[] = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")).records : [];
  writeFileSync(join(hostDir, "run.json"), JSON.stringify({ cond, run: runName, startedAt: new Date().toISOString(), tasks: tasks.map((t) => t.id), deps: JSON.parse(readFileSync(join(import.meta.dir, "deps.json"), "utf8")), stand_in: "Grok Bot responder（Luna／Haiku ではない）" }, null, 2));

  try {
    for (const t of tasks) {
      if (done.some((r) => r.task === t.id)) continue; // 再開時は済んだ課題を飛ばす
      const observer = new PlaywrightObserver(app.hostOrigin, (b) => app.tokens.issue(b));
      const budget = new SubmissionBudget();
      let model: ModelPort;
      let collab: CollaborationModel | null = null;
      let pm: PursuitModel | null = null;
      if (cond === "D") model = new DirectModel(gen);
      else if (cond === "C") model = collab = new CollaborationModel(gen);
      else model = pm = new PursuitModel({ gen, rev: rev!, observer, datasets, budget, ledgerPath: join(hostDir, `ledger-${t.id}.sqlite`), runName });
      const svc = new CanvasService({ store: new Store(null), model: new SeedingModel(model, baseBody(t)), observer, contract, datasets: DATASETS, runTimeoutMs: RUN_TIMEOUT_MS });
      const owner = "p3-owner", session = `p3-${runName}-${t.id}`;
      const rec: TaskRecord = { cond, run: runName, task: t.id, group: t.group, presented: false, submissions: 0, calls: 0, turns: [], final: null, finalDigest: null, error: null };
      let artworkId: string | null = null, revision = 0, n = 0;
      const key = () => `k_${runName}_${t.id.replace(/[^A-Za-z0-9]/g, "")}_${n++}`.slice(0, 64);
      for (const ch of channels) ch.scope = { task: t.id, turn: null };
      try {
        if (t.base) {
          const r = await svc.startRun(owner, session, { message: SEED_REQUEST });
          await svc.drain();
          const st = svc.getRun(owner, r.id);
          if (st.state !== "presented") throw new Error("元作品が観測に通らない: " + st.failure);
          const s = await svc.save(owner, st.presentedCandidateId!, { expectedRevision: 0, idempotencyKey: key() });
          artworkId = (s.result as { artworkId: string }).artworkId;
          revision = 1;
        }
        const conversation: Turn[] = [];
        for (const [ti, turn] of t.turns.entries()) {
          for (const ch of channels) ch.scope = { task: t.id, turn: ti };
          budget.startTurn();
          if (collab) collab.revision = revision;
          const w0 = channels.reduce((a, c) => a + c.waitedMs, 0), c0 = channels.reduce((a, c) => a + c.calls, 0);
          const t0 = performance.now();
          const r = await svc.startRun(owner, session, { message: turn, artworkId, conversation: [...conversation] });
          await svc.drain();
          const st = svc.getRun(owner, r.id);
          const wallMs = performance.now() - t0;
          const waited = channels.reduce((a, c) => a + c.waitedMs, 0) - w0;
          const calls = channels.reduce((a, c) => a + c.calls, 0) - c0;
          // 提出の数：D・C は製品の修正ループの試行、P は write_artwork の回数（製品側の再検査は数えない）
          const submissions = cond === "P" ? (pm!.records.at(-1)?.writes ?? 0) : st.attempts;
          if (cond !== "P") for (let i = 0; i < st.attempts; i++) budget.take();
          rec.turns.push({
            request: turn,
            state: st.state,
            submissions,
            failure: st.failure,
            hostMs: Math.round(wallMs - waited),
            wallMs: Math.round(wallMs),
            calls,
            smokeFailures: st.candidates.flatMap((c) => (c.verification?.checks ?? []).filter((k) => !k.pass).map((k) => `${c.attempt}:${k.id}:${k.detail ?? ""}`.slice(0, 300))),
          });
          rec.submissions += submissions;
          rec.calls += calls;
          conversation.push({ role: "user", text: turn });
          if (st.state !== "presented") break;
          const cand = st.candidates.find((c) => c.id === st.presentedCandidateId)!;
          const s = await svc.save(owner, cand.id, { expectedRevision: revision, idempotencyKey: key() });
          artworkId = (s.result as { artworkId: string }).artworkId;
          revision = (s.result as { revision: number }).revision;
          conversation.push({ role: "assistant", text: cand.reply });
        }
        rec.presented = rec.turns.length === t.turns.length && rec.turns.every((x) => x.state === "presented");
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
        await svc.drain();
        await observer.close();
      }
      if (pm) rec.pursuit = pm.records;
      done.push(rec);
      writeFileSync(join(hostDir, "final", `${t.id}.json`), JSON.stringify({ task: t.id, final: rec.final, finalDigest: rec.finalDigest }, null, 2));
      writeFileSync(resultsFile, JSON.stringify({ cond, run: runName, records: done }, null, 2));
      // 応答者への知らせはホスト観測の結果だけ（隠れた判定の結果は書かない）
      gen.notice("task-end", `課題が終わりました（ホスト観測：${rec.presented ? "全ターンで候補を提示・保存" : "候補を提示できずに終了"}）。次の要求を待ってください。`);
      console.log(`${t.id}: ${rec.presented ? "提示" : "未提示"} 提出 ${rec.submissions} 推論 ${rec.calls} ${rec.turns.map((x) => `${x.state}/${x.hostMs}ms`).join(" → ")}${rec.error ? " " + rec.error : ""}`);
    }
  } finally {
    app.stop();
  }
  writeFileSync(join(hostDir, "DONE"), new Date().toISOString());
  console.log("runner finished");
  process.exit(0);
}

if (import.meta.main) await main();
