// 制作担当（Maker）のプロンプト・出力の形・応答の検査。作品と一緒に宣言（要件と操作）を返させる。
// 評価の条件 D（eval/p3/cond-d.ts）と同じ並び・同じ見出しにし、宣言（spec）と「検証の指摘による直し」の節を足した。
// 条件 D は P3・general-v1 の記録と対応しているので変えず、製品側にここで別に持つ（src/ から eval/ を import しない）。
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ArtworkBody } from "../contract/artwork";
import type { InferenceChannel, Validate } from "./inference";
import { loadMakerSkill, makerSystemPrompt } from "./maker-skill";
import { ModelError, type GenerationInput, type GenerationOutput, type ModelPort } from "./model-port";
import { PLAN_SCHEMA } from "./prompt-evaluator";

export const MAKER_PITFALLS_PATH = resolve(import.meta.dir, "../../docs/maker-pitfalls.md");

/** 制作担当の出力の形。項目の順は title → spec → entry → …（宣言を作品より先に書かせる）。 */
export const MAKER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "spec", "entry", "changes", "unconfirmed", "reply"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 80, description: "作品の題名" },
    spec: {
      type: "object",
      additionalProperties: false,
      required: ["requirements", "controls"],
      description: "作品を書く前に決める宣言。entry より先に書く",
      properties: {
        requirements: { type: "array", items: { type: "string", maxLength: 300 }, minItems: 1, maxItems: 20, description: "依頼に書かれた要件を 1 つずつ短い文にしたもの" },
        controls: {
          type: "array",
          maxItems: 12,
          description: "作品の操作の一覧",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "action", "always"],
            properties: {
              kind: { type: "string", enum: ["key", "pointer"] },
              input: { type: "string", description: "kind が key のときだけ。KeyboardEvent.code の名前" },
              action: { type: "string", maxLength: 100, description: "その操作で起きること" },
              always: { type: "boolean", description: "起動直後から、いつ入力しても画面に変化が出る操作だけ true" },
            },
          },
        },
      },
    },
    entry: { type: "string", minLength: 1, description: "作品の JavaScript 本文（公開された実行契約に従う）" },
    dataRef: { type: "string", description: "登録データを使うときだけ、その ref" },
    libraries: { type: "array", items: { type: "string" }, maxItems: 4, description: "同梱ライブラリを使うときだけ、その id（公開された実行契約の表。例 three@0.187.0）" },
    changes: { type: "string", maxLength: 2000, description: "変更内容の説明" },
    unconfirmed: { type: "array", items: { type: "string" }, maxItems: 20, description: "依頼のうち確かめられていない点" },
    reply: { type: "string", maxLength: 2000, description: "利用者への返答" },
  },
} as const;

const { title: makerTitle, spec: makerSpec, ...makerBodyProperties } = MAKER_OUTPUT_SCHEMA.properties;
const REPLAY_OUTPUT_SCHEMA = {
  ...MAKER_OUTPUT_SCHEMA,
  properties: {
    title: makerTitle,
    spec: makerSpec,
    replay: {
      ...PLAN_SCHEMA.properties.scripts.items,
      description: "依頼の中で実装を誤りやすい挙動を一つ選んで測る手順。purpose に期待する画面の変化を具体的に書く。適切な測定がなければ省略できる",
    },
    ...makerBodyProperties,
  },
};

/** 役割・応答の形・宣言の書き方の前置き。振る舞いの規則は docs/maker-skill.md（制作手順）に置く。 */
export const MAKER_PREAMBLE = [
  "あなたは Canvas の作品（ゲーム・シミュレーション・可視化・3D・物理・HTML の描画）を作る制作担当です。次の制作手順と、要求に含まれる公開された実行契約に従います。",
  "返すのは指定の JSON 一つです。項目は title・spec・entry・changes・unconfirmed・reply（データを使うときだけ dataRef、同梱ライブラリを使うときだけ libraries）。",
  "",
  "spec は作品を書く前に決めて、entry より先に書きます。",
  "- spec.requirements：依頼と会話に書かれた要件を、1 つずつ短い文にした配列（20 個まで）。寸法・色・速さ・時間・操作・得点・終了・やり直しを落とさない。基準の作品がある依頼では、「変える点」と「保つ点」の両方を書く。依頼に無い要件を足さない。",
  '- spec.controls：作品の操作の一覧。キーは { "kind": "key", "input": "Space", "action": "ジャンプ", "always": true }、ポインターは { "kind": "pointer", "action": "凡例を押して絞り込む", "always": true } を 1 つだけ。input は KeyboardEvent.code の名前（Space・ArrowLeft・KeyR・Digit1・Enter など）。',
  "- always は「起動直後から、いつ入力しても画面に変化が出る」操作だけ true にします（移動・ジャンプ・発射など）。条件つきの操作（終了後だけ効くやり直し、球が飛んでいる間は受け付けない操作など）は false にします。",
  "ホストは spec を使って作品を確かめます。宣言した操作を実際に入力して画面の変化を調べ、要件ごとに別の担当（検証担当）が観測に基づいて判定します。実装していない要件・操作を spec に書かないこと。確かめられなかった点は unconfirmed に書きます。",
].join("\n");

/** 制作担当の system：前置き＋制作手順（docs/maker-skill.md）＋（あれば）落とし穴の付録（docs/maker-pitfalls.md）。 */
export function makerSystem(): string {
  const base = makerSystemPrompt(loadMakerSkill(), MAKER_PREAMBLE);
  if (!existsSync(MAKER_PITFALLS_PATH)) return base;
  return `${base}\n\n${readFileSync(MAKER_PITFALLS_PATH, "utf8").trim()}`;
}

function artworkText(b: ArtworkBody, withDataRef: boolean): string {
  return `題名: ${b.title}${withDataRef && b.dataRef ? `\ndataRef: ${b.dataRef}` : ""}${b.libraries?.length ? `\nlibraries: ${b.libraries.join(", ")}` : ""}\n\`\`\`js\n${b.entry}\n\`\`\``;
}

export const SAVED_BASE_GUIDANCE = "この本文は、今回の依頼の直前に選ばれている編集元です。今回の依頼で維持するよう指定された既存の値や挙動は、この版のコードから引き継ぎます。以前の依頼ですでに適用した増減を重ねて適用しません。";

/** 制作担当のプロンプト。条件 D の directPrompt と同じ並び・見出しで、前の候補の節だけが 2 通り。 */
export function makerPrompt(input: GenerationInput): string {
  const parts: string[] = [];
  parts.push(`## 依頼\n${input.request}`);
  if (input.conversation.length) parts.push(`## これまでの会話（古い順）\n${input.conversation.map((t) => `${t.role === "user" ? "利用者" : "あなた"}: ${t.text}`).join("\n")}`);
  if (input.base) parts.push(`## 基準の作品（保存版）\n${SAVED_BASE_GUIDANCE}\n${artworkText(input.base, true)}`);
  else parts.push("## 基準の作品\nなし（新規）");
  parts.push(`## 登録データ\n${input.datasets.length ? input.datasets.map((d) => `- ${d.ref}: ${d.description}`).join("\n") : "なし"}`);
  if (input.previous) {
    const lines = input.observations.map((o) => `- ${o.kind}: ${o.message}`).join("\n") || "- （文なし）";
    if (input.previousPassed === true) {
      parts.push(`## 前の候補（試行 ${input.attempt} 回目の前。ホストの必須の検査には通ったが、検証で指摘があった）\n${artworkText(input.previous, true)}`);
      parts.push(`## 検証の指摘（前の候補）\n「要修正」はすべて直し、「注意」は依頼に照らして必要なら直します。指摘に関係しない部分は変えません。\n${lines}`);
    } else {
      parts.push(`## 前の候補（試行 ${input.attempt} 回目の前。ホスト観測に通らなかった）\n${artworkText(input.previous, true)}`);
      parts.push(`## ホスト観測（前の候補）\n${lines}`);
    }
  }
  parts.push(`## 公開された実行契約\n${input.contract}`);
  return parts.join("\n\n");
}

/** 応答の検査。条件 D の validateArtwork と同じ検査に spec の検査を足す。spec は受け取った値をそのまま入れる（正規化はサービスが行う）。 */
export const validateMakerOutput: Validate<GenerationOutput> = (v) => {
  return validateOutput(v, false);
};

function validateOutput(v: unknown, replay: boolean): ReturnType<Validate<GenerationOutput>> {
  const o = v as Record<string, unknown>;
  const issues: string[] = [];
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, issues: ["オブジェクトではない"] };
  for (const k of Object.keys(o)) if (!(k in MAKER_OUTPUT_SCHEMA.properties) && !(replay && k === "replay")) issues.push(`不明な項目: ${k}`);
  for (const k of MAKER_OUTPUT_SCHEMA.required) if (!(k in o)) issues.push(`項目がない: ${k}`);
  if (typeof o.title !== "string" || !o.title.trim()) issues.push("title は空でない文字列");
  const spec = o.spec as Record<string, unknown> | undefined;
  const specOk =
    !!spec && typeof spec === "object" && !Array.isArray(spec) && Array.isArray(spec.requirements) && spec.requirements.some((r) => typeof r === "string" && r.trim() !== "") && Array.isArray(spec.controls);
  if (!specOk) issues.push("spec は { requirements: 空でない文字列の配列（1 つ以上）, controls: 配列 }");
  if (typeof o.entry !== "string" || !o.entry.trim()) issues.push("entry は空でない文字列");
  if (o.dataRef !== undefined && typeof o.dataRef !== "string") issues.push("dataRef は文字列");
  if (o.libraries !== undefined && (!Array.isArray(o.libraries) || o.libraries.some((x) => typeof x !== "string"))) issues.push("libraries は文字列の配列");
  if (typeof o.changes !== "string") issues.push("changes は文字列");
  if (!Array.isArray(o.unconfirmed) || o.unconfirmed.some((x) => typeof x !== "string")) issues.push("unconfirmed は文字列の配列");
  if (typeof o.reply !== "string") issues.push("reply は文字列");
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    value: {
      body: {
        title: o.title as string,
        entry: o.entry as string,
        ...(o.dataRef ? { dataRef: o.dataRef as string } : {}),
        ...(Array.isArray(o.libraries) && o.libraries.length ? { libraries: o.libraries as string[] } : {}),
      },
      changes: o.changes as string,
      unconfirmed: o.unconfirmed as string[],
      reply: o.reply as string,
      spec: o.spec,
      ...(replay && o.replay !== undefined ? { replay: o.replay } : {}),
    },
  };
}

/** 1 回の推論で作品と宣言を返す制作担当。 */
export class PromptMaker implements ModelPort {
  readonly label: string;
  private system: string;
  constructor(private channel: InferenceChannel, o: { label?: string; system?: string } = {}) {
    this.label = o.label ?? "prompt-maker";
    this.system = o.system ?? makerSystem();
  }
  async generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput> {
    try {
      const replay = input.requestReplay === true;
      const system = replay
        ? this.system + "\n\n依頼の中で間違いやすい挙動を一つ選び、entry の前に replay を提案できます。requirement は spec.requirements の順に R1、R2 … で参照し、purpose に期待する変化、steps に入力と複数時点の shot または track を書きます。測定はホストが行います。"
        : this.system;
      return await this.channel.complete({ purpose: "maker", system, prompt: makerPrompt(input), outputSchema: replay ? REPLAY_OUTPUT_SCHEMA : MAKER_OUTPUT_SCHEMA }, replay ? (v) => validateOutput(v, true) : validateMakerOutput, signal);
    } catch (e) {
      throw new ModelError((e as Error).message);
    }
  }
}
