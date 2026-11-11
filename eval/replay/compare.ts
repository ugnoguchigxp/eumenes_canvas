// Verify complete, comparable live records before reporting the gate.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REPLAY_TASKS } from "./suite";
import type { TaskRecord } from "../p3/run";

type Grade = { task: string; group: string; run: string; pass: boolean; presented: boolean; ms: number; checks: { id: string; pass: boolean; detail?: string }[] };
type Receipt = { task: string; turn: number; status: number; model: string; usage?: {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
} };

const root = resolve(process.argv[2] ?? "eval/out/replay");
const json = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), "utf8"));
const conditions = json<{ model: string; reasoningEffort: string }>("conditions.json");
const controls = json<{ rows: { ok: boolean }[] }>("controls.json");
if (!controls.rows.length || controls.rows.some((r) => !r.ok)) throw new Error("対照の自己確認が未完了");
const environments = new Set<string>();

function receipts(run: string, file: string): Receipt[] {
  const path = join(root, run, "host", file);
  const lines = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  return lines ? lines.split("\n").map((line) => JSON.parse(line)) : [];
}

const tally = (gs: Grade[]) => ({ pass: gs.filter((g) => g.pass).length, n: gs.length });
function summarize(condition: "baseline" | "candidate") {
  const grades: Grade[] = [];
  const allReceipts: Receipt[] = [];
  let makerCalls = 0, judgeCalls = 0, measurements = 0, repaired = 0, repairedAndPassed = 0, judgeErrors = 0;
  for (const i of [1, 2, 3]) {
    const run = `${condition}-r${i}`;
    const { records } = json<{ records: TaskRecord[] }>(`${run}/host/results.json`);
    const settings = json<{ model: string; reasoningEffort: string; review: string; evaluatorModel?: string; evaluatorReasoningEffort?: string; suite: string; cond: string }>(`${run}/host/run.json`);
    const grade = json<{ grades: Grade[]; browser: string }>(`${run}/grade/grades.json`);
    if (settings.model !== conditions.model || settings.reasoningEffort !== conditions.reasoningEffort || settings.cond !== "A" ||
        settings.suite !== "replay" || settings.review !== (condition === "baseline" ? "off" : "replay") ||
        (condition === "candidate" && (settings.evaluatorModel !== conditions.model || settings.evaluatorReasoningEffort !== conditions.reasoningEffort)))
      throw new Error(`実行条件の不一致: ${run}`);
    if (grade.grades.length !== REPLAY_TASKS.length || grade.grades.some((g) => g.run !== run) ||
        REPLAY_TASKS.some((t) => grade.grades.filter((g) => g.task === t.id).length !== 1))
      throw new Error(`採点行の不一致: ${run}`);
    environments.add(grade.browser);
    const maker = receipts(run, "usage.jsonl");
    const judge = condition === "candidate" ? receipts(run, "evaluator-usage.jsonl") : [];
    if (maker.length > 42 || judge.length > 13) throw new Error(`反復あたりの呼出上限: ${run}`);
    if ([...maker, ...judge].some((c) => c.status === 200 && c.model !== conditions.model))
      throw new Error(`実際の応答モデルの不一致: ${run}`);
    for (const r of records) {
      const made = maker.filter((c) => c.task === r.task);
      const judged = judge.filter((c) => c.task === r.task);
      if (made.length > 6 || judged.length > 1 || made.length !== r.calls || judged.length !== r.evalCalls ||
          r.turns.some((_, n) => made.filter((c) => c.turn === n).length > 3))
        throw new Error(`課題の呼出上限または実行記録の不一致: ${run}/${r.task}`);
      let replayed = false;
      for (const t of r.turns) {
        const initial = t.reviews.find((v) => v.replay?.phase === "initial");
        if (initial?.replay?.results.some((v) => v.measures.length > 0)) measurements++;
        if (t.reviews.some((v) => v.error)) judgeErrors++;
        for (const fix of t.reviews.filter((v) => v.replay?.phase === "repair")) {
          if (!initial || JSON.stringify(initial.replay!.plan) !== JSON.stringify(fix.replay!.plan) || fix.evaluatorCalls !== 0)
            throw new Error(`修正前後で再生手順または判定回数が違う: ${run}/${r.task}`);
          if (fix.replay!.results.some((v) => v.measures.length > 0) && !fix.error) replayed = true;
        }
      }
      if (replayed) {
        repaired++;
        if (grade.grades.find((g)=>g.task===r.task)?.pass) repairedAndPassed++;
      }
    }
    grades.push(...grade.grades);
    allReceipts.push(...maker, ...judge);
    makerCalls += maker.length;
    judgeCalls += judge.length;
  }
  const games = tally(grades.filter((g) => g.group !== "nongame"));
  const groups = Object.fromEntries(["new","modify","repair","nongame"].map((group) => [group, tally(grades.filter((g) => g.group === group))]));
  const tasks = Object.fromEntries(REPLAY_TASKS.map((t) => [t.id, tally(grades.filter((g) => g.task === t.id))]));
  const times = grades.filter((g) => g.pass).map((g) => g.ms).sort((a,b) => a-b);
  const p90 = times[Math.ceil(times.length * 0.9) - 1] ?? null;
  const failed = grades.filter((g)=>!g.pass).map(({task,run,checks}) => ({task,run,checks:checks.filter((c)=>!c.pass)}));
  const estimatedUsd = allReceipts.reduce((sum, r) => {
    const u = r.usage;
    if (!u) return sum;
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    const cacheWrite = u.prompt_tokens_details?.cache_write_tokens ?? 0;
    return sum + ((u.prompt_tokens-cached-cacheWrite)*0.10+cached*0.01+cacheWrite*0.125+u.completion_tokens*0.50)/1e6;
  },0);
  return {
    games, groups, tasks, total: tally(grades), presented: grades.filter((g)=>g.presented).length, p90,
    makerCalls, judgeCalls, measurements, repaired, repairedAndPassed, turnsWithReviewError: judgeErrors,
    apiErrors: allReceipts.filter((c)=>c.status!==200).length,
    unknownUsage: allReceipts.filter((c)=>!c.usage).length,
    estimatedUsd: Number(estimatedUsd.toFixed(6)), failed,
    qualityGate: games.pass >= 32 && ["new","modify","repair"].every((g)=>groups[g].pass>=10) && Object.values(tasks).every((t)=>t.pass>=2),
    latencyGate: p90 !== null && p90 <= 150_000,
  };
}
const baseline = summarize("baseline");
const candidate = summarize("candidate");
if (environments.size !== 1) throw new Error("採点のブラウザ環境が一致しない");
const result = { browser: [...environments][0], controls: controls.rows.length, baseline, candidate };
writeFileSync(join(root,"summary.json"), JSON.stringify(result,null,2));
console.log(JSON.stringify({ baseline: baseline.games, candidate: candidate.games, replayed: candidate.repaired },null,2));
