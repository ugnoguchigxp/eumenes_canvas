// 性質の観測と検証担当の指摘、検証の接続口、候補に残す検証の要約。
import type { ArtworkBody } from "../contract/artwork";
import type { EvalPlan, EvalVerdict } from "./eval-types";
import type { ScriptResult } from "./script-runner";
import type { MakerSpec } from "./spec";
import type { CheckResult, Observation, Turn } from "./types";

export interface ReviewFinding {
  source: "probe" | "evaluator";
  severity: "blocking" | "warning" | "info"; // blocking：直すべき。warning：直したほうがよい。info：参考
  id: string;
  message: string;
}

/** off：検証しない（従来どおり）。probes：ホストの性質の観測だけ。judge：観測＋検証担当の判定 1 回。full：観測＋検証担当の台本と判定。 */
export type ReviewMode = "off" | "probes" | "judge" | "full" | "replay";

export interface ReplayRecord {
  phase: "initial" | "repair";
  plan: EvalPlan;
  results: ScriptResult[];
}

export interface ReviewInput {
  request: string;
  conversation: Turn[];
  base: ArtworkBody | null;
  body: ArtworkBody;
  data: unknown;
  spec: MakerSpec | null;
  mode: Exclude<ReviewMode, "off">;
  replay?: { plan: EvalPlan; phase: ReplayRecord["phase"]; observeOnly?: boolean };
}
export interface ReviewOutcome {
  suite: string;
  environment: string;
  checks: CheckResult[]; // 検証記録に足す検査。level は advisory か matched
  findings: ReviewFinding[];
  verdict: EvalVerdict | null;
  evaluatorCalls: number; // 検証担当の推論の回数
  ms: number;
  error: string | null; // 検証そのものが途中で失敗した理由（候補の失敗ではない）
  replay?: ReplayRecord;
}
export interface ReviewerPort {
  readonly suite: string;
  review(input: ReviewInput, signal: AbortSignal): Promise<ReviewOutcome>;
  close(): Promise<void>;
}

/** 候補に残す検証の要約。 */
export interface CandidateReview {
  mode: ReviewMode;
  suite: string;
  blocking: number; // 重い指摘の数
  findings: ReviewFinding[]; // 40 件まで
  verdict: EvalVerdict | null;
  evaluatorCalls: number;
  ms: number;
  error: string | null;
  replay?: ReplayRecord;
}

export function blockingCount(findings: ReviewFinding[]): number {
  return findings.filter((f) => f.severity === "blocking").length;
}

/** 制作担当に返す指摘。info は渡さない（依頼どおりかもしれないことを直させない）。 */
export function findingsAsObservations(findings: ReviewFinding[]): Observation[] {
  return findings
    .filter((f) => f.severity !== "info")
    .slice(0, 12)
    .map((f) => ({ kind: f.source, message: ((f.severity === "blocking" ? "[要修正] " : "[注意] ") + f.message).slice(0, 1200) }));
}

/** 検証そのものが失敗したときの結果（候補の失敗にはしない）。 */
export function failedOutcome(suite: string, error: string, ms: number): ReviewOutcome {
  return { suite, environment: "none", checks: [], findings: [], verdict: null, evaluatorCalls: 0, ms, error: error.slice(0, 500) };
}
