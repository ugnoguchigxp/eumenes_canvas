// 性質の観測と検証担当の指摘、検証の接続口。08 でほかを足す。
import type { ArtworkBody } from "../contract/artwork";
import type { EvalVerdict } from "./eval-types";
import type { MakerSpec } from "./spec";
import type { CheckResult, Turn } from "./types";

export interface ReviewFinding {
  source: "probe" | "evaluator";
  severity: "blocking" | "warning" | "info"; // blocking：直すべき。warning：直したほうがよい。info：参考
  id: string;
  message: string;
}

/** off：検証しない（従来どおり）。probes：ホストの性質の観測だけ。judge：観測＋検証担当の判定 1 回。full：観測＋検証担当の台本と判定。 */
export type ReviewMode = "off" | "probes" | "judge" | "full";

export interface ReviewInput {
  request: string;
  conversation: Turn[];
  base: ArtworkBody | null;
  body: ArtworkBody;
  data: unknown;
  spec: MakerSpec | null;
  mode: Exclude<ReviewMode, "off">;
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
}
export interface ReviewerPort {
  readonly suite: string;
  review(input: ReviewInput, signal: AbortSignal): Promise<ReviewOutcome>;
  close(): Promise<void>;
}
