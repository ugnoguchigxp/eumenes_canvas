// 条件 C：Collaborator。eumenes-collaboration の公開入口で文脈を組み、4 action の JSON を一つ受け取る。
// 作品は登録操作 artwork.propose の invoke で出す。検査に落ちた案は document.rejected として次の推論に渡す。
// system の組み方（rules＋OUTPUT_SCHEMA、引数 schema の差し込み）と ReplyPolicy は、collaboration の example/host.ts に合わせる。
// TOOLS と TOOL_RESULT の書式は core に無い（Eumenes 本体の担当実行側）。ここでは JSON で渡す（docs/p3-eval.md のギャップ）。
import type { GenerationInput, GenerationOutput, ModelPort } from "../../src/core/model-port";
import { ModelError } from "../../src/core/model-port";
import type { FileChannel } from "./channel";
import { collaboration } from "./deps";

const measureReply = (text: string) => ({
  chars: text.length,
  sentences: [...new Intl.Segmenter("ja", { granularity: "sentence" }).segment(text)].filter((s) => s.segment.trim()).length,
});
/** example/host.ts の exampleReplyPolicy と同じ値。 */
export const replyPolicy = {
  maxChars: 300,
  maxSentences: 2,
  validate: (text: string) => {
    const m = measureReply(text);
    return m.chars <= 300 && m.sentences <= 2;
  },
  measure: measureReply,
  description: "利用者への短い返答。replyでは必須。invokeではhostによる成功確定後だけ使う。",
};

export const TOOL_ID = "artwork.propose";
export const TOOL_ARGUMENTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "entry"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 80, description: "作品の題名" },
    entry: { type: "string", minLength: 1, description: "作品の JavaScript 本文の全文（workContext.contract の実行契約に従う）" },
    dataRef: { type: "string", description: "登録データを使うときだけ、その ref（workContext.datasets）" },
    changes: { type: "string", maxLength: 2000, description: "変更内容の説明" },
    unconfirmed: { type: "array", items: { type: "string" }, maxItems: 20, description: "依頼のうち確かめられていない点" },
  },
} as const;
const TOOLS = [
  {
    id: TOOL_ID,
    description:
      "作品の案（全文）を提出する。hostが契約検査とブラウザ観測（起動・実行時エラー・単色でないか・時間や入力で描画が変わるか）を行い、通れば利用者に候補として示す。通らなければ TOOL_RESULT ok:false と、document.rejectedDraft に指摘（issues・fixes）が入る。",
    arguments: TOOL_ARGUMENTS_SCHEMA,
  },
];
export const CALLS_PER_TURN = 3;

function messagesText(messages: { role: string; content: string }[]) {
  return messages.slice(1).map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
}

export class CollaborationModel implements ModelPort {
  readonly label = "p3-collaboration(stand-in: Grok Bot responder)";
  private contract = collaboration.createCollaborationContract(replyPolicy);
  private outputSchema: Record<string, unknown>;
  private callsUsed = 0;
  /** 現在の保存版の番号（savedRef に使う。実行器がターンの前に設定する。新規は 0）。 */
  revision = 0;
  constructor(private ch: FileChannel, private now = () => new Date().toISOString()) {
    const s = this.contract.outputSchema as { properties: Record<string, unknown> };
    this.outputSchema = { ...s, properties: { ...s.properties, arguments: TOOL_ARGUMENTS_SCHEMA } };
  }

  /** 課題の始めに呼ぶ。 */
  reset() {
    this.callsUsed = 0;
    this.revision = 0;
  }

  private system() {
    return {
      role: "system" as const,
      content:
        collaboration.collaborationInstructions.rules +
        "\n文書の改訂ではCURRENT_DOCUMENTの現在版を原文の正本とし、今回指定された変更だけを反映します。保持が指定された本文・手編集は、句読点・括弧・改行も含め原文をそのまま写します。意味が同じでも保持箇所を言い換えたり、書式を正規化したり、削除したりしません。全文を返す場合も、現在版と採用済みの条件を照合してこの制約を守ります。" +
        "\nTOOLS=" +
        JSON.stringify(TOOLS) +
        "\nOUTPUT_SCHEMA=" +
        JSON.stringify(this.outputSchema),
    };
  }

  private context(input: GenerationInput, callsLeft: number) {
    // course：このセッションのこれまでのターン（会話は user・assistant の組で来る）。
    // document.revision はこのセッションでの作業文書の版（読み込んだ基準作品が 0、ターンの採用ごとに 1 進む）。
    // 保存版の番号は savedRef に別に持つ（基準作品の読み込みを「画面での変更」と誤って示さないため）。
    const course: { utterance: string; steps?: { tool: string; ok: boolean; revision?: number }[]; outcome: "completed"; reply?: string }[] = [];
    const conv = input.conversation;
    let rev = 0;
    for (let i = 0; i < conv.length; i++) {
      if (conv[i].role !== "user") continue;
      const reply = conv[i + 1]?.role === "assistant" ? conv[i + 1].text : undefined;
      course.push({ utterance: conv[i].text, steps: [{ tool: TOOL_ID, ok: true, revision: ++rev }], outcome: "completed", ...(reply ? { reply } : {}) });
    }
    const docRevision = rev;
    const rejected = input.previous
      ? {
          title: input.previous.title,
          text: input.previous.entry,
          issues: input.observations.map((o) => ({ path: "entry", rule: o.kind })),
          fixes: input.observations.map((o) => o.message),
          createdAt: this.now(),
        }
      : null;
    return {
      system: this.system(),
      utterance: input.request,
      course: { course, interrupted: null, handedOver: null },
      work: {
        label: input.base?.title ?? "新しい作品",
        dirty: false,
        current: undefined,
        context: { contract: input.contract, datasets: input.datasets },
        savedRef: input.base ? `artwork:r${this.revision}` : null,
      },
      viewing: null,
      time: { now: this.now(), timeZone: "Asia/Tokyo" },
      callsLeft,
      document: {
        path: "artwork.js",
        revision: docRevision,
        title: input.base?.title ?? "新しい作品",
        outlined: false,
        body: input.base?.entry ?? "",
        rejected,
        inlineBytes: 128 * 1024,
      },
    };
  }

  async generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput> {
    if (input.attempt === 0) this.callsUsed = 0; // 新しいターン
    let correction: { output: unknown; issues: unknown } | null = null;
    while (this.callsUsed < CALLS_PER_TURN) {
      const callsLeft = CALLS_PER_TURN - this.callsUsed;
      const messages = collaboration.buildCollaborationMessages(this.context(input, callsLeft) as never);
      if (input.previous) messages.push({ role: "user", content: "TOOL_RESULT=" + JSON.stringify({ tool: TOOL_ID, ok: false, error: "host_checks_failed", detail: input.observations.map((o) => `${o.kind}: ${o.message}`).join(" / ").slice(0, 2000), issues: input.observations.map((o) => ({ path: "entry", rule: o.kind })) }) });
      if (correction) messages.push({ role: "user", content: collaboration.collaborationInstructions.correction + "\nREJECTED_OUTPUT=" + JSON.stringify(correction).slice(0, 140_000) });
      this.callsUsed++;
      let out: unknown;
      try {
        out = await this.ch.complete({ purpose: correction ? "collaboration-correction" : "collaboration", system: messages[0].content, prompt: messagesText(messages), outputSchema: this.outputSchema }, (v) => ({ ok: true, value: v }), signal, 0);
      } catch (e) {
        throw new ModelError((e as Error).message);
      }
      const checked = this.contract.check(out);
      if (!checked.ok) {
        correction = { output: out, issues: checked.violations };
        continue;
      }
      const a = checked.action;
      if (a.kind !== "invoke") throw new ModelError(`作品を出さずにターンを終えた（action=${a.kind}${"text" in a && a.text ? `: ${String(a.text).slice(0, 200)}` : ""}）`);
      if (a.tool !== TOOL_ID) {
        correction = { output: out, issues: [{ path: "tool", code: "unknown_tool", expected: TOOL_ID }] };
        continue;
      }
      const g = a.arguments as Record<string, unknown>;
      const bad: unknown[] = [];
      if (typeof g.title !== "string" || !g.title.trim()) bad.push({ path: "arguments.title", code: "required" });
      if (typeof g.entry !== "string" || !g.entry.trim()) bad.push({ path: "arguments.entry", code: "required" });
      for (const k of Object.keys(g)) if (!(k in TOOL_ARGUMENTS_SCHEMA.properties)) bad.push({ path: `arguments.${k}`, code: "unrecognized_key" });
      if (bad.length) {
        correction = { output: out, issues: bad };
        continue;
      }
      return {
        body: { title: g.title as string, entry: g.entry as string, ...(typeof g.dataRef === "string" && g.dataRef ? { dataRef: g.dataRef } : {}) },
        changes: typeof g.changes === "string" ? g.changes : "",
        unconfirmed: Array.isArray(g.unconfirmed) ? g.unconfirmed.map(String) : [],
        reply: a.text ?? "",
      };
    }
    throw new ModelError(`このターンの推論の上限（${CALLS_PER_TURN} 回）に達した`);
  }
}
