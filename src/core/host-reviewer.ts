// 検証のまとめ役。ホストの性質の観測 → （full なら）検証担当の台本とその実行 → 検証担当の判定 → 正規化 → 検査と指摘。
// 検証担当の生の出力は、ここで必ず正規化してから使う。検証担当の失敗で検証全体を止めない（台本が失敗しても判定へ、判定が失敗しても観測の指摘は返す）。
import { normalizePlan, normalizeVerdict, type EvalVerdict } from "./eval-types";
import type { EvaluatorPort } from "./evaluator-port";
import { lineDiff } from "./line-diff";
import { probeChecks, probeEvidenceIds, probeFindings, probeText, type ProbePort } from "./probes";
import type { ReviewerPort, ReviewFinding, ReviewInput, ReviewOutcome } from "./review";
import { scriptEvidenceIds, scriptText, type ScriptResult } from "./script-runner";
import type { MakerSpec } from "./spec";
import type { CheckResult } from "./types";

const msgOf = (e: unknown) => String((e as Error)?.message ?? e);
const VERDICT_WORD = { pass: "確認した", fail: "満たしていない", unknown: "未確認" } as const;

/** 要件ごとの検査（level は matched）。 */
export function verdictChecks(v: EvalVerdict): CheckResult[] {
  return v.verdicts.map((r) => ({ id: `req:${r.requirement}`, level: "matched", pass: r.verdict === "pass", detail: (VERDICT_WORD[r.verdict] + (r.note ? `：${r.note}` : "")).slice(0, 300) }));
}

/** 判定から指摘を作る。fail の要件で同じ要件の指摘が無いものは、重い指摘として足す。 */
export function verdictFindings(v: EvalVerdict, spec: MakerSpec): ReviewFinding[] {
  const evText = (ev: string[]) => (ev.length ? `（証拠: ${ev.join(", ")}）` : "");
  const out: ReviewFinding[] = v.issues.map((i, k) => ({
    source: "evaluator",
    severity: i.severity === "blocking" ? "blocking" : "warning",
    id: `E-${k + 1}`,
    message: `${i.requirement ? `[${i.requirement}] ` : ""}${i.symptom}${i.suggestion ? `／直し方の案：${i.suggestion}` : ""}${evText(i.evidence)}`,
  }));
  const covered = new Set(v.issues.map((i) => i.requirement).filter((r): r is string => r !== null));
  for (const r of v.verdicts) {
    if (r.verdict !== "fail" || covered.has(r.requirement)) continue;
    const text = spec.requirements.find((q) => q.id === r.requirement)?.text ?? "";
    out.push({ source: "evaluator", severity: "blocking", id: `E-req-${r.requirement}`, message: `[${r.requirement}] 要件「${text}」を満たしていない${r.note ? `：${r.note}` : ""}${evText(r.evidence)}` });
  }
  return out;
}

export class HostReviewer implements ReviewerPort {
  readonly suite: string;
  constructor(private lab: ProbePort, private evaluator: EvaluatorPort | null) {
    this.suite = lab.suite;
  }

  async review(input: ReviewInput, signal: AbortSignal): Promise<ReviewOutcome> {
    const t0 = performance.now();
    const report = await this.lab.probe(input.body, input.data, input.spec, signal);
    const out: ReviewOutcome = { suite: this.suite, environment: report.environment, checks: probeChecks(report), findings: probeFindings(report), verdict: null, evaluatorCalls: 0, ms: 0, error: null };
    const done = () => ((out.ms = Math.round(performance.now() - t0)), out);
    if (input.mode === "probes" || !report.booted || !this.evaluator) return done();
    const spec = input.spec;
    if (!spec) {
      out.error = "制作担当の宣言（spec）が無いため、検証担当の判定を省いた";
      return done();
    }
    const pText = probeText(report);
    let results: ScriptResult[] = [];
    if (input.mode === "full") {
      try {
        out.evaluatorCalls++;
        const raw = await this.evaluator.plan({ request: input.request, conversation: input.conversation, hasBase: !!input.base, spec, probeText: pText }, signal);
        const plan = normalizePlan(raw, spec);
        if (plan.scripts.length) results = await this.lab.runScripts(input.body, input.data, plan, signal);
      } catch (e) {
        if (signal.aborted) throw e;
        out.error = "台本の段階で失敗: " + msgOf(e);
        results = [];
      }
    }
    try {
      out.evaluatorCalls++;
      const evidenceIds = [...probeEvidenceIds(report), ...scriptEvidenceIds(results)];
      let diffText: string | null = null;
      if (input.base) {
        const d = lineDiff(input.base.entry, input.body.entry);
        diffText = `追加 ${d.added} 行・削除 ${d.removed} 行${d.truncated ? "（長いので途中まで）" : ""}\n${d.text}`;
      }
      const raw = await this.evaluator.judge(
        { request: input.request, conversation: input.conversation, spec, body: input.body, probeText: pText, scriptText: scriptText(results), diffText, evidenceIds },
        signal,
      );
      const verdict = normalizeVerdict(raw, spec, new Set(evidenceIds));
      out.verdict = verdict;
      out.checks.push(...verdictChecks(verdict));
      out.findings.push(...verdictFindings(verdict, spec));
    } catch (e) {
      if (signal.aborted) throw e;
      out.error = ((out.error ? out.error + " ／ " : "") + "判定の段階で失敗: " + msgOf(e)).slice(0, 500);
    }
    return done();
  }

  close(): Promise<void> {
    return this.lab.close();
  }
}
