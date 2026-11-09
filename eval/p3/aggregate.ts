// P3 の集計（評価担当）。results.json・usage.jsonl・grades.json から、条件ごとの表を作る。平均を条件・課題群をまたいで混ぜない。
//   bun eval/p3/aggregate.ts --root /workspace/canvas_p3 [--out docs/eval/p3-summary.json]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { UsageRow } from "./channel";
import type { Grade } from "./grade";
import type { TaskRecord } from "./run";
import { TASKS } from "./run";

const GROUPS = ["new", "modify", "repair", "nongame"] as const;
const NAME: Record<string, string> = { new: "新規", modify: "部分修正", repair: "不具合修復", nongame: "非ゲーム", games: "ゲーム計" };
const THRESH: Record<string, [number, number]> = { new: [10, 12], modify: [10, 12], repair: [10, 12], games: [32, 36], nongame: [2, 3] };

export function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

async function main() {
  const { values } = parseArgs({ options: { root: { type: "string" }, out: { type: "string" } } });
  const root = resolve(values.root ?? "/workspace/canvas_p3");
  const runs = readdirSync(root).filter((d) => /^[DCP]-r\d+$/.test(d)).sort();
  const records: TaskRecord[] = [];
  const usage: UsageRow[] = [];
  for (const run of runs) {
    const f = join(root, run, "host/results.json");
    if (existsSync(f)) records.push(...(JSON.parse(readFileSync(f, "utf8")) as { records: TaskRecord[] }).records);
    const u = join(root, run, "host/usage.jsonl");
    if (existsSync(u)) usage.push(...readFileSync(u, "utf8").trim().split("\n").filter(Boolean).map((l) => ({ ...JSON.parse(l), run }) as UsageRow & { run: string }));
  }
  const gf = join(root, "grade/grades.json");
  const grades: Grade[] = existsSync(gf) ? JSON.parse(readFileSync(gf, "utf8")).grades : [];
  const gradeOf = (r: TaskRecord) => grades.find((g) => g.run === r.run && g.task === r.task);
  const out: Record<string, unknown> = {};
  for (const cond of ["D", "C", "P"]) {
    const rs = records.filter((r) => r.cond === cond);
    if (!rs.length) continue;
    const u = (usage as (UsageRow & { run: string })[]).filter((x) => x.cond === cond);
    const pass = (r: TaskRecord) => !!gradeOf(r)?.v1.pass;
    const groups: Record<string, unknown> = {};
    const sel = (g: string, exN3 = false) => rs.filter((r) => (g === "games" ? r.group !== "nongame" : r.group === g) && (!exN3 || r.task !== "N3-shooter"));
    for (const g of [...GROUPS, "games"]) {
      const all = sel(g), ex = sel(g, true);
      groups[g] = { name: NAME[g], pass: all.filter(pass).length, n: all.length, threshold: THRESH[g], meets: all.length === THRESH[g][1] ? all.filter(pass).length >= THRESH[g][0] : null, exN3: g === "new" || g === "games" ? { pass: ex.filter(pass).length, n: ex.length } : undefined };
    }
    const perTask = TASKS.map((t) => {
      const ts = rs.filter((r) => r.task === t.id);
      return { task: t.id, pass: ts.filter(pass).length, n: ts.length, v2: t.id === "N3-shooter" ? ts.filter((r) => gradeOf(r)?.v2?.pass).length : undefined, presented: ts.filter((r) => r.presented).length, meets: ts.length === 3 ? ts.filter(pass).length >= 2 : null };
    });
    const passing = rs.filter(pass);
    const hostMs = passing.map((r) => r.turns.reduce((a, x) => a + x.hostMs, 0));
    const sub = (xs: TaskRecord[]) => xs.map((r) => r.submissions);
    const callRows = u.filter((x) => x.status !== "aborted");
    const byTrial = new Map<string, { calls: number; promptChars: number; responseChars: number }>();
    for (const x of callRows) {
      const k = `${(x as UsageRow & { run: string }).run}|${x.task}`;
      const v = byTrial.get(k) ?? { calls: 0, promptChars: 0, responseChars: 0 };
      v.calls++;
      v.promptChars += x.promptChars;
      v.responseChars += x.responseChars;
      byTrial.set(k, v);
    }
    const trials = [...byTrial.values()];
    // 課題群ごとの提出・時間・推論・文字数（群をまたいで混ぜない）
    const byGroup = Object.fromEntries([...GROUPS, "games"].map((g) => {
      const all = sel(g);
      const ok = all.filter(pass);
      const hm = ok.map((r) => r.turns.reduce((a, x) => a + x.hostMs, 0));
      const keys = new Set(all.map((r) => `${r.run}|${r.task}`));
      const rows = callRows.filter((x) => keys.has(`${(x as UsageRow & { run: string }).run}|${x.task}`));
      const perTrial = all.map((r) => rows.filter((x) => (x as UsageRow & { run: string }).run === r.run && x.task === r.task).length);
      return [g, {
        pass: ok.length, n: all.length,
        submissions: { total: all.reduce((a, r) => a + r.submissions, 0), medianAll: pct(sub(all), 50), p90All: pct(sub(all), 90), medianPassing: pct(sub(ok), 50), p90Passing: pct(sub(ok), 90) },
        hostMsPassing: { p50: pct(hm, 50), p90: pct(hm, 90), n: hm.length },
        calls: { total: rows.length, perTrialMedian: pct(perTrial, 50), perTrialP90: pct(perTrial, 90) },
        chars: { prompt: rows.reduce((a, x) => a + x.promptChars, 0), response: rows.reduce((a, x) => a + x.responseChars, 0), tokensEstimate: Math.ceil(rows.reduce((a, x) => a + x.promptChars + x.responseChars, 0) / 4) },
      }];
    }));
    const smokeOkEvalFail = rs.filter((r) => r.presented && gradeOf(r) && !gradeOf(r)!.v1.pass).map((r) => ({ run: r.run, task: r.task, failed: gradeOf(r)!.v1.checks.filter((c) => !c.pass).map((c) => `[${c.kind}] ${c.id}: ${c.detail ?? ""}`.slice(0, 200)) }));
    out[cond] = {
      trials: rs.length,
      graded: rs.filter((r) => gradeOf(r)).length,
      presented: rs.filter((r) => r.presented).length,
      groups,
      byGroup,
      perTask,
      tasksMeeting: perTask.filter((t) => t.meets).length,
      submissionsToPass: { median: pct(sub(passing), 50), p90: pct(sub(passing), 90), firstSubmissionPasses: passing.filter((r) => r.submissions === r.turns.length).length, n: passing.length },
      hostMsPassing: { p50: pct(hostMs, 50), p90: pct(hostMs, 90), max: hostMs.length ? Math.max(...hostMs) : null, n: hostMs.length },
      calls: { total: callRows.length, perTrialMedian: pct(trials.map((t) => t.calls), 50), perTrialP90: pct(trials.map((t) => t.calls), 90), byPurpose: Object.fromEntries([...new Set(callRows.map((x) => x.purpose))].map((p) => [p, callRows.filter((x) => x.purpose === p).length])), invalid: callRows.filter((x) => x.status === "invalid").length },
      chars: { prompt: callRows.reduce((a, x) => a + x.promptChars, 0), response: callRows.reduce((a, x) => a + x.responseChars, 0), tokensEstimate: Math.ceil(callRows.reduce((a, x) => a + x.promptChars + x.responseChars, 0) / 4) },
      smokeOkEvalFail,
      notPresented: rs.filter((r) => !r.presented).map((r) => ({ run: r.run, task: r.task, why: (r.error ?? r.turns.at(-1)?.failure ?? "").slice(0, 300) })),
    };
  }
  const D = out.D as { calls: { total: number }; chars: { tokensEstimate: number } } | undefined;
  for (const c of ["C", "P"]) {
    const x = out[c] as { calls: { total: number }; chars: { tokensEstimate: number }; extraVsD?: unknown } | undefined;
    if (x && D) x.extraVsD = { callsRatio: +(x.calls.total / D.calls.total).toFixed(2), tokensRatio: +(x.chars.tokensEstimate / D.chars.tokensEstimate).toFixed(2), extraCalls: x.calls.total - D.calls.total, extraTokensEstimate: x.chars.tokensEstimate - D.chars.tokensEstimate };
  }
  const json = JSON.stringify({ generatedAt: new Date().toISOString(), runs, gradesPartial: existsSync(gf) ? JSON.parse(readFileSync(gf, "utf8")).partial : null, conditions: out }, null, 2);
  if (values.out) writeFileSync(values.out, json);
  console.log(json);
}
if (import.meta.main) await main();
