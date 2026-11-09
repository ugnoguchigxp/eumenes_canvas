// 制作担当（代行の応答者）とのファイル応答。要求を <dir>/requests/<id>.json に書き、<dir>/responses/<id>.json を待つ。
// 応答が JSON でない・形が違うときは理由を <id>.error.txt に書き、同じ要求を -retry<k> として出し直す（最大 2 回）。
// 推論の回数・文字数・待ち時間は usage.jsonl に残す（応答者からは見えない host/ に置く）。
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface UsageRow {
  at: string;
  cond: string;
  task: string | null;
  turn: number | null;
  role: string;
  purpose: string;
  id: string;
  promptChars: number;
  responseChars: number;
  waitMs: number;
  status: "ok" | "invalid" | "aborted";
}

export interface ChannelScope {
  task: string | null;
  turn: number | null;
}

export type Validate<T> = (value: unknown) => { ok: true; value: T } | { ok: false; issues: unknown };

export class FileChannel {
  private n = 0;
  scope: ChannelScope = { task: null, turn: null };
  /** 応答者を待った時間の合計（ホスト側の時間から除く）。 */
  waitedMs = 0;
  /** 推論の回数（形の違う応答の出し直しも数える）。 */
  calls = 0;
  constructor(
    readonly dir: string,
    readonly role: string,
    private usageFile: string,
    private cond: string,
    private pollMs = 500,
  ) {
    mkdirSync(join(dir, "requests"), { recursive: true });
    mkdirSync(join(dir, "responses"), { recursive: true });
    // 再起動しても前の要求番号と重ならないようにする
    this.n = Number(existsSync(join(dir, ".counter")) ? readFileSync(join(dir, ".counter"), "utf8") : "0") || 0;
  }

  /** 1 回の推論。形の違う応答は最大 maxRetries 回まで出し直し、それぞれ推論 1 回として数える。 */
  async complete<T>(req: { purpose: string; system: string; prompt: string; outputSchema: unknown; maxOutputChars?: number }, validate: Validate<T>, signal: AbortSignal, maxRetries = 2): Promise<T> {
    const base = `${this.role}-${String(++this.n).padStart(4, "0")}`;
    writeFileSync(join(this.dir, ".counter"), String(this.n));
    let previous: { id: string; error: unknown } | null = null;
    for (let k = 0; ; k++) {
      const id = k === 0 ? base : `${base}-retry${k}`;
      const body = { id, role: this.role, purpose: req.purpose, maxOutputChars: req.maxOutputChars ?? 131072, system: req.system, prompt: req.prompt, outputSchema: req.outputSchema, ...(previous ? { retryOf: previous.id, previousError: previous.error } : {}) };
      const tmp = join(this.dir, "requests", `.${id}.tmp`);
      writeFileSync(tmp, JSON.stringify(body, null, 2));
      renameSync(tmp, join(this.dir, "requests", `${id}.json`));
      const t0 = performance.now();
      const target = join(this.dir, "responses", `${id}.json`);
      while (!existsSync(target)) {
        if (signal.aborted) {
          this.log({ id, purpose: req.purpose, promptChars: req.system.length + req.prompt.length, responseChars: 0, waitMs: performance.now() - t0, status: "aborted" });
          throw new Error("aborted");
        }
        await new Promise((r) => setTimeout(r, this.pollMs));
      }
      const text = readFileSync(target, "utf8");
      const waitMs = performance.now() - t0;
      let json: unknown;
      let issues: unknown = null;
      try {
        json = JSON.parse(text);
      } catch (e) {
        issues = { message: "JSON ではない: " + String(e).slice(0, 300) };
      }
      if (!issues && text.length > (req.maxOutputChars ?? 131072)) issues = { message: `応答が長すぎる（${text.length} 文字、上限 ${req.maxOutputChars ?? 131072}）` };
      if (!issues) {
        const v = validate(json);
        if (v.ok) {
          this.log({ id, purpose: req.purpose, promptChars: req.system.length + req.prompt.length, responseChars: text.length, waitMs, status: "ok" });
          return v.value;
        }
        issues = v.issues;
      }
      this.log({ id, purpose: req.purpose, promptChars: req.system.length + req.prompt.length, responseChars: text.length, waitMs, status: "invalid" });
      writeFileSync(join(this.dir, "responses", `${id}.error.txt`), JSON.stringify(issues, null, 2));
      if (k >= maxRetries) throw new Error(`応答の形が違う（${maxRetries + 1} 回）`);
      previous = { id, error: issues };
    }
  }

  /** 課題の終わりなど、応答者への知らせ（判定の結果は書かない）。 */
  notice(name: string, text: string) {
    mkdirSync(join(this.dir, "notices"), { recursive: true });
    writeFileSync(join(this.dir, "notices", `${String(++this.n).padStart(4, "0")}-${name}.txt`), text);
    writeFileSync(join(this.dir, ".counter"), String(this.n));
  }

  private log(r: Omit<UsageRow, "at" | "cond" | "task" | "turn" | "role">) {
    this.waitedMs += r.waitMs;
    if (r.status !== "aborted") this.calls++;
    const row: UsageRow = { at: new Date().toISOString(), cond: this.cond, task: this.scope.task, turn: this.scope.turn, role: this.role, ...r, waitMs: Math.round(r.waitMs) };
    appendFileSync(this.usageFile, JSON.stringify(row) + "\n");
  }
}
