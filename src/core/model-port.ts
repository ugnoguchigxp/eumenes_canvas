// 制作担当の接続口。製品コードはモデル名を持たず、設定から選んだ提供者を使う。
import type { ArtworkBody } from "../contract/artwork";
import type { Observation, Turn } from "./types";

export interface DatasetInfo {
  ref: string;
  description: string;
}

export interface GenerationInput {
  /** 利用者の原依頼（このターン）。 */
  request: string;
  /** これまでの会話（このターンを含まない）。 */
  conversation: Turn[];
  /** 基準となる作品（新規なら null）。 */
  base: ArtworkBody | null;
  baseDigest: string | null;
  /** 公開された実行契約。 */
  contract: string;
  datasets: DatasetInfo[];
  /** 0 が初回、1・2 が修正。 */
  attempt: number;
  /** 直前の候補（修正時）。 */
  previous: ArtworkBody | null;
  previousDigest: string | null;
  observations: Observation[];
  /** 直前の候補がホストの必須の検査に通っていたか（真なら observations は検証の指摘）。省略時は偽。 */
  previousPassed?: boolean;
}

export interface GenerationOutput {
  body: ArtworkBody;
  /** 変更内容の説明。 */
  changes: string;
  /** 依頼のうち未確認の点。 */
  unconfirmed: string[];
  /** 会話への返答。 */
  reply: string;
  /** 制作担当の宣言（要件と操作）。形はホストが正規化する（src/core/spec.ts）。 */
  spec?: unknown;
}

export interface ModelPort {
  /** 設定上の名前（ログ・記録用）。 */
  readonly label: string;
  generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput>;
}

export class ModelError extends Error {}
