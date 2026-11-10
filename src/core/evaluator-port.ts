// 検証担当（Evaluator）の接続口。戻り値は正規化しない（正規化はまとめ役 HostReviewer が必ず行う）。
// 台本づくりには作品のコードを渡さない（実装に合わせた台本にしないため）。判定にはコードと差分を渡す。
import type { ArtworkBody } from "../contract/artwork";
import type { MakerSpec } from "./spec";
import type { Turn } from "./types";

export interface EvalPlanInput {
  request: string;
  conversation: Turn[];
  hasBase: boolean; // 基準の作品があるか（変更・修復の依頼か）
  spec: MakerSpec;
  probeText: string; // 03 の観測の文（画面の要約を含む）
}
export interface EvalJudgeInput {
  request: string;
  conversation: Turn[];
  spec: MakerSpec;
  body: ArtworkBody; // 作品のコード
  probeText: string;
  scriptText: string;
  diffText: string | null; // 基準の作品との差分。基準が無ければ null
  evidenceIds: string[]; // 引用できる証拠 id（観測と測定）
}
export interface EvaluatorPort {
  readonly label: string;
  plan(input: EvalPlanInput, signal: AbortSignal): Promise<unknown>;
  judge(input: EvalJudgeInput, signal: AbortSignal): Promise<unknown>;
}
