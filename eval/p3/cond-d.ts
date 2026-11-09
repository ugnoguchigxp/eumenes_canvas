// 条件 D：直接生成。製品の ModelPort の入力をそのまま 1 回の推論に渡し、作品の JSON を受け取る。
import type { GenerationInput, GenerationOutput, ModelPort } from "../../src/core/model-port";
import { ModelError } from "../../src/core/model-port";
import type { FileChannel, Validate } from "./channel";

export const ARTWORK_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "entry", "changes", "unconfirmed", "reply"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 80, description: "作品の題名" },
    entry: { type: "string", minLength: 1, description: "作品の JavaScript 本文（公開された実行契約に従う）" },
    dataRef: { type: "string", description: "登録データを使うときだけ、その ref" },
    changes: { type: "string", maxLength: 2000, description: "変更内容の説明" },
    unconfirmed: { type: "array", items: { type: "string" }, maxItems: 20, description: "依頼のうち確かめられていない点" },
    reply: { type: "string", maxLength: 2000, description: "利用者への返答" },
  },
} as const;

export const validateArtwork: Validate<GenerationOutput> = (v) => {
  const o = v as Record<string, unknown>;
  const issues: string[] = [];
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, issues: ["オブジェクトではない"] };
  for (const k of Object.keys(o)) if (!(k in ARTWORK_OUTPUT_SCHEMA.properties)) issues.push(`不明な項目: ${k}`);
  for (const k of ARTWORK_OUTPUT_SCHEMA.required) if (!(k in o)) issues.push(`項目がない: ${k}`);
  if (typeof o.title !== "string" || !o.title.trim()) issues.push("title は空でない文字列");
  if (typeof o.entry !== "string" || !o.entry.trim()) issues.push("entry は空でない文字列");
  if (o.dataRef !== undefined && typeof o.dataRef !== "string") issues.push("dataRef は文字列");
  if (typeof o.changes !== "string") issues.push("changes は文字列");
  if (!Array.isArray(o.unconfirmed) || o.unconfirmed.some((x) => typeof x !== "string")) issues.push("unconfirmed は文字列の配列");
  if (typeof o.reply !== "string") issues.push("reply は文字列");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      body: { title: o.title as string, entry: o.entry as string, ...(o.dataRef ? { dataRef: o.dataRef as string } : {}) },
      changes: o.changes as string,
      unconfirmed: o.unconfirmed as string[],
      reply: o.reply as string,
    },
  };
};

export const DIRECT_SYSTEM = [
  "あなたは Canvas 2D の作品（ゲーム・可視化）を作る制作担当です。利用者の依頼に沿って作品を作る、または基準の作品を直します。",
  "- 作品は「公開された実行契約」に従う JavaScript 一つです。契約にない API・外部通信・外部コードの読み込みは使えません。",
  "- 基準の作品があるときは、依頼された点だけを変え、それ以外の動き・見た目は保ちます。",
  "- 前の候補とホスト観測があるときは、観測を基に直します。ホスト観測は起動・実行時エラー・単色でないか・時間や入力で描画が変わるかだけを確かめます。",
  "- 返すのは指定の JSON 一つです（title・entry・changes・unconfirmed・reply、データを使うときだけ dataRef）。",
].join("\n");

export function directPrompt(input: GenerationInput): string {
  const parts: string[] = [];
  parts.push(`## 依頼\n${input.request}`);
  if (input.conversation.length) parts.push(`## これまでの会話（古い順）\n${input.conversation.map((t) => `${t.role === "user" ? "利用者" : "あなた"}: ${t.text}`).join("\n")}`);
  if (input.base) parts.push(`## 基準の作品（保存版）\n題名: ${input.base.title}${input.base.dataRef ? `\ndataRef: ${input.base.dataRef}` : ""}\n\`\`\`js\n${input.base.entry}\n\`\`\``);
  else parts.push("## 基準の作品\nなし（新規）");
  parts.push(`## 登録データ\n${input.datasets.length ? input.datasets.map((d) => `- ${d.ref}: ${d.description}`).join("\n") : "なし"}`);
  if (input.previous) {
    parts.push(`## 前の候補（試行 ${input.attempt} 回目の前。ホスト観測に通らなかった）\n題名: ${input.previous.title}\n\`\`\`js\n${input.previous.entry}\n\`\`\``);
    parts.push(`## ホスト観測（前の候補）\n${input.observations.map((o) => `- ${o.kind}: ${o.message}`).join("\n") || "- （観測の文なし）"}`);
  }
  parts.push(`## 公開された実行契約\n${input.contract}`);
  return parts.join("\n\n");
}

export class DirectModel implements ModelPort {
  readonly label = "p3-direct(stand-in: Grok Bot responder)";
  constructor(private ch: FileChannel) {}
  async generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput> {
    try {
      return await this.ch.complete({ purpose: "direct", system: DIRECT_SYSTEM, prompt: directPrompt(input), outputSchema: ARTWORK_OUTPUT_SCHEMA }, validateArtwork, signal);
    } catch (e) {
      throw new ModelError((e as Error).message);
    }
  }
}
