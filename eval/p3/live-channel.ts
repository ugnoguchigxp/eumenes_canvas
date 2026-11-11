import { appendFileSync } from "node:fs";
import type { InferenceChannel, InferenceRequest, Validate } from "../../src/core/inference";
import { HttpChannel, InferenceLimitError, MAX_MODEL_RESPONSE_BYTES, type HttpChannelOptions } from "../../src/server/http-channel";
import { readBoundedText } from "../../src/server/read-body";

export const LIVE_TASK_MS = 180_000;
export const LIVE_REQUEST_BYTES = 65_536;
export const LIVE_MAX_OUTPUT = 8_192;

/** 同じ課題の再試行も含めて、実 API の呼び出しと使用量を記録する。 */
export class LiveChannel implements InferenceChannel {
  calls = 0;
  waitedMs = 0;
  scope: { task: string; turn: number | null } = { task: "", turn: null };
  private task = "";
  private turn: number | null = null;
  private deadline = 0;
  private taskCalls = 0;
  private turnCalls = 0;
  private channel: HttpChannel;

  constructor(options: HttpChannelOptions, usageFile: string, private maxCalls: number, private limits = { task: 6, turn: 3 }) {
    if (!options.apiKeyEnv || !process.env[options.apiKeyEnv]) throw new Error("実モデルの API キーの環境変数が設定されていない");
    this.channel = new HttpChannel(options, {
      fetch: async (url, init) => {
        if (this.taskCalls >= limits.task || this.turnCalls >= limits.turn || this.calls >= maxCalls) throw new InferenceLimitError("calls");
        if (Buffer.byteLength(init.body) > LIVE_REQUEST_BYTES) throw new InferenceLimitError("request");
        const remainingMs = Math.ceil(this.deadline - performance.now());
        if (remainingMs <= 0) throw new InferenceLimitError("time");
        this.calls++;
        this.taskCalls++;
        this.turnCalls++;
        const t0 = performance.now();
        const signal = AbortSignal.any([init.signal, AbortSignal.timeout(remainingMs)]);
        let receipt: { status?: number; model?: string; usage?: unknown; finish?: string } = {};
        try {
          const r = await fetch(url, { ...init, signal, redirect: "error" });
          receipt.status = r.status;
          if (!r.ok) {
            void r.body?.cancel().catch(() => {});
            return new Response(null, { status: r.status });
          }
          const text = await readBoundedText(r, MAX_MODEL_RESPONSE_BYTES, signal);
          let d;
          try { d = JSON.parse(text); } catch { d = null; }
          if (typeof d?.choices?.[0]?.message?.content === "string") {
            receipt = { status: r.status, model: d.model, usage: d.usage, finish: d.choices[0].finish_reason };
          }
          return new Response(text || null, { status: r.status });
        } finally {
          const ms = performance.now() - t0;
          this.waitedMs += ms;
          appendFileSync(usageFile, JSON.stringify({ ...this.scope, ...receipt, ms: Math.round(ms) }) + "\n");
        }
      },
    });
  }

  canCallInTask(): boolean {
    return this.calls < this.maxCalls && (this.scope.task !== this.task || this.taskCalls < this.limits.task);
  }

  complete<T>(req: InferenceRequest, validate: Validate<T>, signal: AbortSignal, maxRetries?: number): Promise<T> {
    if (this.task !== this.scope.task) {
      this.task = this.scope.task;
      this.deadline = performance.now() + LIVE_TASK_MS;
      this.taskCalls = 0;
      this.turn = null;
    }
    if (this.turn !== this.scope.turn) {
      this.turn = this.scope.turn;
      this.turnCalls = 0;
    }
    return this.channel.complete(req, validate, signal, maxRetries);
  }
}
