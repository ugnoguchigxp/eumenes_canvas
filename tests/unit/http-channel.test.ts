// 09：OpenAI 互換の HTTP の推論の接続口（偽の fetch。外へ通信しない）。
import { describe, expect, test } from "bun:test";
import type { Validate } from "../../src/core/inference";
import { HttpChannel, type HttpChannelOptions } from "../../src/server/http-channel";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { model: string; messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[]; temperature?: number; max_tokens?: number };
}
/** 受け取った要求を覚え、決めた応答を順に返す偽の fetch。 */
function fakeFetch(replies: ({ status?: number; content?: string; raw?: string } | "hang")[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: { headers: Record<string, string>; body: string; signal: AbortSignal }) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const r = replies[Math.min(sent.length - 1, replies.length - 1)];
    if (r === "hang")
      return new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted"))));
    const status = r.status ?? 200;
    const text = r.raw ?? JSON.stringify({ choices: [{ message: { content: r.content } }] });
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { sent, fetch };
}
const OPTS: HttpChannelOptions = { baseUrl: "http://127.0.0.1:9/v1/", model: "local-model", apiKeyEnv: "TEST_KEY" };
const SCHEMA = { type: "object", required: ["x"], properties: { x: { type: "number" } } };
const REQ = { purpose: "eval-judge", system: "SYS", prompt: "PROMPT", outputSchema: SCHEMA };
const hasX: Validate<{ x: number }> = (v) => (v && typeof v === "object" && typeof (v as { x?: unknown }).x === "number" ? { ok: true, value: v as { x: number } } : { ok: false, issues: ["x が数であること"] });
const sig = () => new AbortController().signal;

describe("HttpChannel", () => {
  test("正しい応答", async () => {
    const f = fakeFetch([{ content: '{"x": 1}' }]);
    const ch = new HttpChannel({ ...OPTS, temperature: 0.2, maxTokens: 100 }, { fetch: f.fetch, env: {} });
    expect(await ch.complete(REQ, hasX, sig())).toEqual({ x: 1 });
    const s = f.sent[0];
    expect(s.url).toBe("http://127.0.0.1:9/v1/chat/completions");
    expect(s.body.model).toBe("local-model");
    expect(s.body.messages[0].role).toBe("system");
    expect(s.body.messages[0].content).toStartWith("SYS\n\n# 出力\n次の JSON Schema に合う JSON を 1 つだけ返してください。");
    expect(s.body.messages[0].content).toEndWith(JSON.stringify(SCHEMA));
    expect(s.body.messages[1]).toEqual({ role: "user", content: "PROMPT" });
    expect([s.body.temperature, s.body.max_tokens]).toEqual([0.2, 100]);
    expect(s.headers["content-type"]).toBe("application/json");
  });

  test("API キー", async () => {
    const f = fakeFetch([{ content: '{"x": 1}' }, { status: 401, raw: "bad key sk-secret-123" }]);
    const withKey = new HttpChannel(OPTS, { fetch: f.fetch, env: { TEST_KEY: "sk-secret-123" } });
    await withKey.complete(REQ, hasX, sig());
    expect(f.sent[0].headers.authorization).toBe("Bearer sk-secret-123");
    const err = await withKey.complete(REQ, hasX, sig()).catch((e: Error) => e);
    expect(String((err as Error).message)).toContain("モデルの応答が得られない: 401");
    expect(String((err as Error).message)).not.toContain("sk-secret-123");
    const g = fakeFetch([{ content: '{"x": 1}' }]);
    await new HttpChannel(OPTS, { fetch: g.fetch, env: {} }).complete(REQ, hasX, sig());
    expect(g.sent[0].headers.authorization).toBeUndefined();
    // 既定の (process.env) でも、キーの値は設定に書かない
    expect(JSON.stringify(OPTS)).not.toContain("sk-");
  });

  test("推論強度・新しい出力トークン上限・保存設定を送る", async () => {
    const f = fakeFetch([{ content: '{"x": 1}' }]);
    const ch = new HttpChannel({ ...OPTS, reasoningEffort: "low", maxTokens: 100, maxCompletionTokens: 200, store: false }, { fetch: f.fetch, env: {} });
    await ch.complete(REQ, hasX, sig());
    expect(f.sent[0].body).toMatchObject({ reasoning_effort: "low", max_completion_tokens: 200, store: false });
    expect(f.sent[0].body).not.toHaveProperty("max_tokens");
  });

  test("画像を指定した要求では本文と同じメッセージにPNGを添付する", async () => {
    const f = fakeFetch([{ content: '{"x": 1}' }]);
    const ch = new HttpChannel(OPTS, { fetch: f.fetch, env: {} });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await ch.complete({ ...REQ, images: [{ mediaType: "image/png", bytes }] }, hasX, sig(), 0);
    expect(f.sent[0].body.messages[1]).toEqual({ role: "user", content: [
      { type: "text", text: "PROMPT" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw==" } },
    ] });
  });

  test("囲みつきの JSON", async () => {
    const f = fakeFetch([{ content: '説明\n```json\n{"x": 2}\n```\n' }]);
    expect(await new HttpChannel(OPTS, { fetch: f.fetch, env: {} }).complete(REQ, hasX, sig())).toEqual({ x: 2 });
  });

  test("形の違う応答", async () => {
    const f = fakeFetch([{ content: '{"y": 1}' }, { content: '{"x": 3}' }]);
    expect(await new HttpChannel(OPTS, { fetch: f.fetch, env: {} }).complete(REQ, hasX, sig())).toEqual({ x: 3 });
    expect(f.sent.length).toBe(2);
    const u = f.sent[1].body.messages[1].content;
    expect(u).toStartWith("PROMPT\n\n# 前の応答は受け付けられませんでした\n");
    expect(u).toContain("x が数であること");
    expect(u).toEndWith("形を直して、もう一度 JSON を 1 つだけ返してください。");
  });

  test("3 回とも形違い", async () => {
    const f = fakeFetch([{ content: "JSON ではない文" }]);
    await expect(new HttpChannel(OPTS, { fetch: f.fetch, env: {} }).complete(REQ, hasX, sig())).rejects.toThrow("応答の形が違う（3 回）");
    expect(f.sent.length).toBe(3);
    expect(f.sent[1].body.messages[1].content).toContain('"JSON ではない"');
  });

  test("応答が長すぎる", async () => {
    const f = fakeFetch([{ content: '{"x": 1, "pad": "' + "a".repeat(100) + '"}' }, { content: '{"x": 1}' }]);
    expect(await new HttpChannel(OPTS, { fetch: f.fetch, env: {} }).complete({ ...REQ, maxOutputChars: 50 }, hasX, sig())).toEqual({ x: 1 });
    expect(f.sent[1].body.messages[1].content).toContain("応答が長すぎる");
  });

  test("HTTP の失敗", async () => {
    const f = fakeFetch([{ status: 500, raw: "internal error" }]);
    await expect(new HttpChannel(OPTS, { fetch: f.fetch, env: {} }).complete(REQ, hasX, sig())).rejects.toThrow("モデルの応答が得られない: 500 internal error");
  });

  test("中断", async () => {
    const f = fakeFetch(["hang"]);
    const ac = new AbortController();
    const p = new HttpChannel(OPTS, { fetch: f.fetch, env: {} }).complete(REQ, hasX, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toThrow("aborted");
    // 時間切れ
    const q = new HttpChannel({ ...OPTS, timeoutMs: 20 }, { fetch: fakeFetch(["hang"]).fetch, env: {} }).complete(REQ, hasX, sig());
    await expect(q).rejects.toThrow("モデルの応答が得られない: 時間切れ");
  });

  test("fenced", async () => {
    const MAKER_SCHEMA = { type: "object", required: ["title", "entry"], properties: { title: { type: "string" }, entry: { type: "string" } } };
    const isMaker: Validate<{ title: string; entry: string }> = (v) => (v && typeof (v as { entry?: unknown }).entry === "string" ? { ok: true, value: v as { title: string; entry: string } } : { ok: false, issues: ["entry"] });
    const entry = 'const s = "a\\"b";\nconsole.log(`x\n y`);\n// ENTRY の中の ENTRY\nENTRY_X';
    const f = fakeFetch([{ content: "目印なし" }, { content: `<<<META\n{"title": "跳ぶ"}\nMETA\n<<<ENTRY\n${entry}\nENTRY\n` }]);
    const ch = new HttpChannel({ ...OPTS, format: "fenced" }, { fetch: f.fetch, env: {} });
    const out = await ch.complete({ purpose: "maker", system: "SYS", prompt: "P", outputSchema: MAKER_SCHEMA }, isMaker, sig());
    expect(out).toEqual({ title: "跳ぶ", entry });
    expect(f.sent.length).toBe(2);
    expect(f.sent[1].body.messages[1].content).toContain("目印（<<<META・<<<ENTRY）が無い");
    const sys = f.sent[0].body.messages[0].content;
    expect(sys).toContain("<<<META\n（entry 以外の項目を、次の JSON Schema に合う JSON で）\nMETA\n<<<ENTRY");
    expect(sys).not.toContain('"entry"');
    // 検証担当（entry の無い出力）には fenced を使わない
    const g = fakeFetch([{ content: '{"x": 1}' }]);
    expect(await new HttpChannel({ ...OPTS, format: "fenced" }, { fetch: g.fetch, env: {} }).complete(REQ, hasX, sig())).toEqual({ x: 1 });
    expect(g.sent[0].body.messages[0].content).not.toContain("<<<META");
  });
});

describe("設定から組み立てる", () => {
  test("制作担当・検証担当", async () => {
    const { makeEvaluator, makeModel } = await import("../../src/server/main");
    const m = makeModel({ provider: "openai-compatible", label: "local-maker", baseUrl: "http://127.0.0.1:9/v1", model: "m" }, "/");
    expect(m.label).toBe("local-maker");
    expect(makeEvaluator(undefined)).toBeNull();
    expect(makeEvaluator({ provider: "openai-compatible", label: "local-eval", baseUrl: "http://127.0.0.1:9/v1", model: "m" })!.label).toBe("local-eval");
  });
});
