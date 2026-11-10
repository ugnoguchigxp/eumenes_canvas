// 検証担当（Evaluator）のプロンプト・出力の形・PromptEvaluator。細かい形の検査はしない（正規化は eval-types.ts が受け持つ）。
import { resolve } from "node:path";
import type { EvalJudgeInput, EvalPlanInput, EvaluatorPort } from "./evaluator-port";
import type { InferenceChannel, Validate } from "./inference";
import { loadMakerSkill, makerSystemPrompt } from "./maker-skill";
import type { MakerSpec } from "./spec";
import type { Turn } from "./types";

export const EVALUATOR_SKILL_PATH = resolve(import.meta.dir, "../../docs/evaluator-skill.md");

export const EVALUATOR_PREAMBLE = ["あなたは Canvas の作品の検証担当です。制作担当とは別の担当で、作品は作らず、直しません。次の検証の手順に従います。", "返すのは指定の JSON 一つです。"].join("\n");

/** 検証担当の system：前置き＋検証の手順（docs/evaluator-skill.md）。 */
export function evaluatorSystem(): string {
  const skill = loadMakerSkill(EVALUATOR_SKILL_PATH);
  return makerSystemPrompt(skill, EVALUATOR_PREAMBLE).replace(`# 制作手順（${skill.name}）`, `# 検証の手順（${skill.name}）`);
}

const STEP_DO = ["wait", "keyDown", "keyUp", "tap", "click", "drag", "shot", "track"];
const POINT = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };

export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scripts"],
  properties: {
    scripts: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirement", "purpose", "steps"],
        properties: {
          requirement: { type: "string", description: "確かめる要件の id" },
          purpose: { type: "string", maxLength: 120 },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 30,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["do"],
              properties: {
                do: { type: "string", enum: STEP_DO },
                ms: { type: "number" },
                input: { type: "string" },
                holdMs: { type: "number" },
                x: { type: "number" },
                y: { type: "number" },
                from: POINT,
                to: POINT,
                color: { type: "string" },
                label: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts", "issues", "summary"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirement", "verdict", "evidence", "note"],
        properties: {
          requirement: { type: "string" },
          verdict: { type: "string", enum: ["pass", "fail", "unknown"] },
          evidence: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
      },
    },
    issues: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "symptom", "evidence", "suggestion"],
        properties: {
          severity: { type: "string", enum: ["blocking", "minor"] },
          requirement: { type: "string" },
          symptom: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          suggestion: { type: "string" },
        },
      },
    },
    summary: { type: "string", maxLength: 400 },
  },
} as const;

function conversationText(c: Turn[]): string | null {
  return c.length ? `## これまでの会話（古い順）\n${c.map((t) => `${t.role === "user" ? "利用者" : "制作担当"}: ${t.text}`).join("\n")}` : null;
}

function specText(spec: MakerSpec): string {
  const req = spec.requirements.map((r) => `- ${r.id}: ${r.text}`).join("\n");
  const ctl = spec.controls.length
    ? spec.controls.map((c) => `- ${c.kind === "key" ? `キー ${c.input}` : "ポインター"}：${c.action}（${c.always ? "いつでも効く" : "条件つき"}）`).join("\n")
    : "- （宣言なし）";
  return `## 制作担当の宣言\n### 要件\n${req}\n### 操作\n${ctl}`;
}

const requestText = (request: string, changing: boolean) => (changing ? `## 依頼（基準の作品に対する変更・修復）\n${request}` : `## 依頼（新規）\n${request}`);
const join = (parts: (string | null)[]) => parts.filter((p): p is string => p !== null).join("\n\n");

/** 台本づくりのプロンプト。作品のコードは入れない。 */
export function planPrompt(input: EvalPlanInput): string {
  return join([
    "## することは台本づくり（plan）\n下の要件のうち、動かして測らないと確かめられないものについて、台本を書いてください。",
    requestText(input.request, input.hasBase),
    conversationText(input.conversation),
    specText(input.spec),
    `## ホストの観測（各行の先頭が証拠 id）\n${input.probeText}`,
  ]);
}

/** 判定のプロンプト。観測・測定・差分・コードを渡す。 */
export function judgePrompt(input: EvalJudgeInput): string {
  const b = input.body;
  return join([
    "## することは判定（judge）\n下の要件それぞれについて、観測と測定を証拠にして判定してください。",
    requestText(input.request, input.diffText !== null),
    conversationText(input.conversation),
    specText(input.spec),
    `## ホストの観測（各行の先頭が証拠 id）\n${input.probeText}`,
    `## 台本の測定（各行の先頭が証拠 id）\n${input.scriptText}`,
    `## 引用できる証拠\n${[...input.evidenceIds, "CODE", "DIFF"].join(", ")}\n（pass の根拠にできるのは CODE・DIFF 以外）`,
    input.diffText !== null ? `## 基準の作品との差分（証拠 id は DIFF。行頭の + は追加、- は削除）\n\`\`\`diff\n${input.diffText}\n\`\`\`` : null,
    `## 作品のコード（証拠 id は CODE）\n題名: ${b.title}${b.libraries?.length ? `\nlibraries: ${b.libraries.join(", ")}` : ""}\n\`\`\`js\n${b.entry}\n\`\`\``,
  ]);
}

const hasArray = (key: string): Validate<unknown> => (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as Record<string, unknown>)[key]) ? { ok: true, value: v } : { ok: false, issues: [`物であり、${key} が配列であること`] };

/** 1 回ずつの推論で台本と判定を返す検証担当。 */
export class PromptEvaluator implements EvaluatorPort {
  readonly label: string;
  private system: string;
  constructor(private channel: InferenceChannel, o: { label?: string; system?: string } = {}) {
    this.label = o.label ?? "prompt-evaluator";
    this.system = o.system ?? evaluatorSystem();
  }
  plan(input: EvalPlanInput, signal: AbortSignal): Promise<unknown> {
    return this.channel.complete({ purpose: "eval-plan", system: this.system, prompt: planPrompt(input), outputSchema: PLAN_SCHEMA, maxOutputChars: 16_000 }, hasArray("scripts"), signal);
  }
  judge(input: EvalJudgeInput, signal: AbortSignal): Promise<unknown> {
    return this.channel.complete({ purpose: "eval-judge", system: this.system, prompt: judgePrompt(input), outputSchema: VERDICT_SCHEMA, maxOutputChars: 16_000 }, hasArray("verdicts"), signal);
  }
}
