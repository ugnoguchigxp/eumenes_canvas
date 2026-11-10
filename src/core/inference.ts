// 1 回の推論の接続口。制作担当も検証担当も「system・prompt・出力の形を渡して、形の合った JSON の値を受け取る」推論でできている。
// 評価の FileChannel（記録・代行の応答）と、実モデルの HTTP の接続（09）が同じ形で実装する。

export interface InferenceRequest {
  purpose: string; // 記録用の名前。"maker"・"eval-plan"・"eval-judge"
  system: string;
  prompt: string;
  outputSchema: unknown; // 出力の JSON Schema
  maxOutputChars?: number;
}
export type Validate<T> = (value: unknown) => { ok: true; value: T } | { ok: false; issues: unknown };
export interface InferenceChannel {
  /** 形の違う応答は、理由を付けて出し直す（最大 maxRetries 回）。それでも違えば例外。 */
  complete<T>(req: InferenceRequest, validate: Validate<T>, signal: AbortSignal, maxRetries?: number): Promise<T>;
}
