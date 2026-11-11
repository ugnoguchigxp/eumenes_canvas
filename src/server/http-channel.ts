// OpenAI 互換の Chat Completions（POST <baseUrl>/chat/completions）で呼べるモデルを InferenceChannel として使う。
// 接続先がこの形でない場合は、このファイルだけを別の実装に差し替える（PromptMaker・PromptEvaluator は変えない）。
// モデルの名前は設定にだけ書く。API キーは環境変数の名前だけを設定に書き、例外の文・ログに入れない。
import type { InferenceChannel, InferenceRequest, Validate } from "../core/inference";

export interface HttpChannelOptions {
  baseUrl: string; // 例 "http://127.0.0.1:11434/v1"
  model: string; // 接続先でのモデルの名前
  apiKeyEnv?: string; // API キーを入れた環境変数の名前（キーそのものは設定に書かない）
  temperature?: number; // 省略時は送らない
  maxTokens?: number; // 省略時は送らない
  maxCompletionTokens?: number;
  reasoningEffort?: string;
  store?: boolean;
  timeoutMs?: number; // 既定 120_000
  format?: "json" | "fenced"; // 既定 "json"。制作担当には "fenced" も使える
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const JSON_INSTRUCTION = "\n\n# 出力\n次の JSON Schema に合う JSON を 1 つだけ返してください。説明やコードの囲みは付けません。\n";
const FENCED_INSTRUCTION = [
  "",
  "",
  "# 出力",
  "次の 2 つの部分を、この順に、この目印どおりに返してください。ほかの文は書きません。",
  "<<<META",
  "（entry 以外の項目を、次の JSON Schema に合う JSON で）",
  "META",
  "<<<ENTRY",
  "（作品の JavaScript 本文をそのまま。エスケープしない）",
  "ENTRY",
  "",
].join("\n");

/** 出力の Schema から entry を外す（fenced のとき）。 */
function withoutEntry(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const s = schema as { properties?: Record<string, unknown>; required?: string[] };
  const { entry: _e, ...properties } = s.properties ?? {};
  return { ...s, properties, ...(s.required ? { required: s.required.filter((k) => k !== "entry") } : {}) };
}

type Parsed = { ok: true; value: unknown } | { ok: false; reason: string };

/** 文字列から JSON を取り出す：全体、``` の囲みの中身、最初の { から最後の } の順に試す。 */
export function extractJson(text: string): Parsed {
  const tries: string[] = [text.trim()];
  const fence = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(text);
  if (fence) tries.push(fence[1].trim());
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      return { ok: true, value: JSON.parse(t) };
    } catch {
      // 次を試す
    }
  }
  return { ok: false, reason: "JSON ではない" };
}

/** fenced の応答から { ...META, entry } を取り出す。entry は最後の \nENTRY までをそのまま使う。 */
export function extractFenced(text: string): Parsed {
  const t = text.replace(/\r\n/g, "\n");
  const m0 = t.indexOf("<<<META\n"), m1 = m0 >= 0 ? t.indexOf("\nMETA", m0 + 8) : -1;
  const e0 = t.indexOf("<<<ENTRY\n"), e1 = t.lastIndexOf("\nENTRY");
  if (m0 < 0 || m1 < 0 || e0 < 0 || e1 < e0 + 8) return { ok: false, reason: "目印（<<<META・<<<ENTRY）が無い" };
  let meta: unknown;
  try {
    meta = JSON.parse(t.slice(m0 + 8, m1));
  } catch {
    return { ok: false, reason: "JSON ではない" };
  }
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return { ok: false, reason: "JSON ではない" };
  return { ok: true, value: { ...(meta as object), entry: t.slice(e0 + 9, e1) } };
}

export class HttpChannel implements InferenceChannel {
  private fetch: FetchLike;
  constructor(private o: HttpChannelOptions, deps: { fetch?: FetchLike; env?: Record<string, string | undefined> } = {}) {
    this.fetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.env = deps.env ?? process.env;
  }
  private env: Record<string, string | undefined>;

  async complete<T>(req: InferenceRequest, validate: Validate<T>, signal: AbortSignal, maxRetries = 2): Promise<T> {
    // fenced は出力に entry の項目がある要求（制作担当）にだけ使う
    const hasEntry = !!(req.outputSchema as { properties?: Record<string, unknown> } | null)?.properties?.entry;
    const fenced = this.o.format === "fenced" && hasEntry;
    const system = req.system + (fenced ? FENCED_INSTRUCTION + JSON.stringify(withoutEntry(req.outputSchema)) : JSON_INSTRUCTION + JSON.stringify(req.outputSchema));
    let user = req.prompt;
    for (let k = 0; ; k++) {
      const text = await this.post(system, user, req.images, signal);
      let issues: unknown;
      if (req.maxOutputChars !== undefined && text.length > req.maxOutputChars) issues = "応答が長すぎる";
      else {
        const parsed = fenced ? extractFenced(text) : extractJson(text);
        if (!parsed.ok) issues = parsed.reason;
        else {
          const v = validate(parsed.value);
          if (v.ok) return v.value;
          issues = v.issues;
        }
      }
      if (k >= maxRetries) throw new Error(`応答の形が違う（${maxRetries + 1} 回）`);
      user = `${req.prompt}\n\n# 前の応答は受け付けられませんでした\n${JSON.stringify(issues)}\n形を直して、もう一度 JSON を 1 つだけ返してください。`;
    }
  }

  private async post(system: string, user: string, images: InferenceRequest["images"], signal: AbortSignal): Promise<string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const key = this.o.apiKeyEnv ? this.env[this.o.apiKeyEnv] : undefined;
    if (key) headers.authorization = `Bearer ${key}`;
    const content = images?.length
      ? [{ type: "text", text: user }, ...images.map(({ mediaType, bytes }) => ({
          type: "image_url",
          image_url: { url: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}` },
        }))]
      : user;
    const body = {
      model: this.o.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      ...(this.o.temperature !== undefined ? { temperature: this.o.temperature } : {}),
      ...(this.o.maxCompletionTokens !== undefined
        ? { max_completion_tokens: this.o.maxCompletionTokens }
        : this.o.maxTokens !== undefined ? { max_tokens: this.o.maxTokens } : {}),
      ...(this.o.reasoningEffort !== undefined ? { reasoning_effort: this.o.reasoningEffort } : {}),
      ...(this.o.store !== undefined ? { store: this.o.store } : {}),
    };
    // signal と timeoutMs の両方で打ち切る
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (signal.aborted) throw new Error("aborted");
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), this.o.timeoutMs ?? 120_000);
    try {
      let res;
      try {
        res = await this.fetch(`${this.o.baseUrl.replace(/\/+$/, "")}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal });
      } catch (e) {
        if (signal.aborted) throw new Error("aborted");
        throw new Error("モデルの応答が得られない: " + (ac.signal.aborted ? "時間切れ" : this.redact(String((e as Error)?.message ?? e)).slice(0, 200)));
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`モデルの応答が得られない: ${res.status} ${this.redact(text).slice(0, 200)}`);
      let content: unknown;
      try {
        content = (JSON.parse(text) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
      } catch {
        content = undefined;
      }
      if (typeof content !== "string") throw new Error(`モデルの応答が得られない: ${res.status} ${this.redact(text).slice(0, 200)}`);
      return content;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** 例外の文に API キーが入らないようにする。 */
  private redact(s: string): string {
    const key = this.o.apiKeyEnv ? this.env[this.o.apiKeyEnv] : undefined;
    return key ? s.split(key).join("***") : s;
  }
}
