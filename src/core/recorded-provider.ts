// 記録済み推論（recorded-inference）の提供者。生成の入力から鍵を計算し、記録した出力を返す。
// 記録に無い入力はエラーにする（推測で埋めない）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { artworkDigest, sha256Hex } from "../contract/artwork";
import { ModelError, type GenerationInput, type GenerationOutput, type ModelPort } from "./model-port";

export interface RecordingFile {
  /** 記録の出所。例：「Grok Bot が代行して作成」。 */
  author: string;
  recordings: Recording[];
}

export interface BodyRef {
  title: string;
  entryFile: string;
  dataRef?: string;
  libraries?: string[];
  runtime?: "page";
}

export interface Recording {
  /** 鍵に使う入力の要約。baseDigest・previousDigest の代わりに baseFrom・previousFrom（作品ファイル）を書ける。 */
  input: Omit<RecordedInputKey, "baseDigest" | "previousDigest"> & {
    baseDigest?: string | null;
    previousDigest?: string | null;
    baseFrom?: BodyRef;
    previousFrom?: BodyRef;
  };
  output: {
    title: string;
    entryFile: string; // 記録ファイルからの相対パス
    dataRef?: string;
    libraries?: string[];
    /** ページ直接モードの作品（design.md §8）。ページ直接モードが有効な設定でだけ契約に通る。 */
    runtime?: "page";
    changes: string;
    unconfirmed: string[];
    reply: string;
  };
  /** 応答までの模擬遅延（取消・期限の試験用）。 */
  latencyMs?: number;
  note?: string;
  /** 同じ入力に対する別の試行（評価で 3 回試すため）。既定 0。 */
  sample?: number;
}

export interface RecordedInputKey {
  request: string;
  conversation: string[];
  baseDigest: string | null;
  attempt: number;
  previousDigest: string | null;
}

export async function keyOf(k: RecordedInputKey, sample = 0): Promise<string> {
  return sha256Hex(JSON.stringify([k.request, k.conversation, k.baseDigest, k.attempt, k.previousDigest, sample]));
}

export function inputKey(input: GenerationInput): RecordedInputKey {
  return {
    request: input.request,
    conversation: input.conversation.map((t) => `${t.role}:${t.text}`),
    baseDigest: input.baseDigest,
    attempt: input.attempt,
    previousDigest: input.previousDigest,
  };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new ModelError("aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ModelError("aborted"));
    }, { once: true });
  });
}

export class RecordedProvider implements ModelPort {
  readonly label: string;
  private byKey = new Map<string, { rec: Recording; entry: string }>();
  private ready: Promise<void>;
  /** 記録の遅延を無視して返す（遅延は取消・期限の試験でのみ使う）。 */
  ignoreLatency = false;
  /** 遅延後でも取消を無視して結果を返す（遅れて届いた結果の破棄を試すため）。 */
  deliverAfterAbort = false;
  /** 引く試行の番号（記録の sample と照合する）。 */
  sample = 0;
  constructor(files: string[], label = "recorded") {
    this.label = label;
    this.ready = this.load(files);
  }
  private async load(files: string[]) {
    for (const f of files) {
      const j = JSON.parse(readFileSync(f, "utf8")) as RecordingFile;
      const dir = dirname(f);
      const digestOf = async (b: BodyRef) =>
        artworkDigest({ title: b.title, entry: readFileSync(join(dir, b.entryFile), "utf8"), ...(b.dataRef ? { dataRef: b.dataRef } : {}), ...(b.libraries?.length ? { libraries: b.libraries } : {}), ...(b.runtime === "page" ? { runtime: "page" as const } : {}) });
      for (const rec of j.recordings) {
        const entry = readFileSync(join(dir, rec.output.entryFile), "utf8");
        const i = rec.input;
        const key: RecordedInputKey = {
          request: i.request,
          conversation: i.conversation ?? [],
          attempt: i.attempt,
          baseDigest: i.baseFrom ? await digestOf(i.baseFrom) : (i.baseDigest ?? null),
          previousDigest: i.previousFrom ? await digestOf(i.previousFrom) : (i.previousDigest ?? null),
        };
        const k = await keyOf(key, rec.sample ?? 0);
        if (this.byKey.has(k)) throw new Error(`同じ入力の記録が重複: ${f} ${i.request}`);
        this.byKey.set(k, { rec, entry });
      }
    }
  }
  async generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput> {
    await this.ready;
    const k = inputKey(input);
    const hit = this.byKey.get(await keyOf(k, this.sample));
    if (!hit) throw new ModelError("記録にない入力: " + JSON.stringify({ request: k.request.slice(0, 40), attempt: k.attempt, sample: this.sample, baseDigest: k.baseDigest?.slice(0, 19), previousDigest: k.previousDigest?.slice(0, 19) }));
    if (hit.rec.latencyMs && !this.ignoreLatency) {
      try {
        await sleep(hit.rec.latencyMs, signal);
      } catch (e) {
        if (!this.deliverAfterAbort) throw e;
        await new Promise((r) => setTimeout(r, hit.rec.latencyMs));
      }
    }
    const o = hit.rec.output;
    return {
      body: { title: o.title, entry: hit.entry, ...(o.dataRef ? { dataRef: o.dataRef } : {}), ...(o.libraries?.length ? { libraries: o.libraries } : {}), ...(o.runtime === "page" ? { runtime: "page" as const } : {}) },
      changes: o.changes,
      unconfirmed: o.unconfirmed,
      reply: o.reply,
    };
  }
}
