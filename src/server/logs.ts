// 検証ホストの診断ログ。JSON Lines で追記し、上限を超えたら 1 世代だけ残して切り替える。
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export const LOG_MAX_BYTES = 5 * 1024 * 1024;

/** 端末の時差付き ISO 8601（例 2026-11-09T22:55:01.234+09:00）。 */
export function isoWithOffset(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 23);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${local}${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export class JsonlLog {
  private size = -1;
  constructor(readonly path: string, private maxBytes = LOG_MAX_BYTES) {}

  write(rec: Record<string, unknown>) {
    const line = JSON.stringify({ ts: isoWithOffset(), ...rec }) + "\n";
    try {
      if (this.size < 0) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.size = existsSync(this.path) ? statSync(this.path).size : 0;
      }
      const n = Buffer.byteLength(line);
      if (this.size > 0 && this.size + n > this.maxBytes) {
        renameSync(this.path, this.path + ".1"); // 古い .1 は上書きする
        this.size = 0;
      }
      appendFileSync(this.path, line);
      this.size += n;
    } catch (e) {
      console.error("[canvas] ログを書けません", this.path, e);
    }
  }
}

export interface ServerLogs {
  server: JsonlLog;
  client: JsonlLog;
  dir: string;
}

export function openLogs(dir: string | null | undefined, maxBytes = LOG_MAX_BYTES): ServerLogs | null {
  if (!dir) return null;
  return { dir, server: new JsonlLog(join(dir, "server.log"), maxBytes), client: new JsonlLog(join(dir, "client.log"), maxBytes) };
}

/** 記録用のパス。問い合わせの値は落としてキー名だけ残し、Worker のトークンは伏せる。 */
export function logPath(url: URL, rawUrl = url.href): string {
  let p = url.pathname;
  if (p.startsWith("/w/")) p = "/w/[token]";
  const keys = [...new Set([...url.searchParams.keys()])];
  if (keys.length) return `${p}?${keys.map((k) => encodeURIComponent(k)).join("&")}`;
  // 空の問い合わせ（名前の無いフォームの既定送信で付く "/?"）も区別して残す
  return rawUrl.includes("?") ? p + "?" : p;
}

/** 要求の見出し（本文・cookie・session は含めない）。 */
export function requestFields(req: Request, url: URL) {
  const h = req.headers;
  const out: Record<string, string> = { method: req.method, path: logPath(url, req.url) };
  for (const k of ["origin", "sec-fetch-site", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-user"]) {
    const v = h.get(k);
    if (v) out[k.replace(/-/g, "_")] = v.slice(0, 200);
  }
  return out;
}

/** 受け取った診断イベントを、文字列・数値・真偽値だけの平らな形に整える。 */
export const CLIENT_LOG_LIMITS = { maxBytes: 16 * 1024, maxEvents: 50, maxKeys: 20, maxString: 500, perMinute: 120 };

export function sanitizeClientEvents(body: unknown): Record<string, string | number | boolean>[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { events?: unknown }).events)) return null;
  const events = (body as { events: unknown[] }).events;
  if (events.length > CLIENT_LOG_LIMITS.maxEvents) return null;
  const out: Record<string, string | number | boolean>[] = [];
  for (const e of events) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const rec: Record<string, string | number | boolean> = {};
    let n = 0;
    for (const [k, v] of Object.entries(e as Record<string, unknown>)) {
      if (n >= CLIENT_LOG_LIMITS.maxKeys) break;
      if (!/^[A-Za-z][A-Za-z0-9_.]{0,39}$/.test(k)) continue;
      if (typeof v === "string") rec[k] = v.slice(0, CLIENT_LOG_LIMITS.maxString);
      else if (typeof v === "number" && Number.isFinite(v)) rec[k] = v;
      else if (typeof v === "boolean") rec[k] = v;
      else continue;
      n++;
    }
    if (typeof rec.type === "string") out.push(rec);
  }
  return out;
}

/** 1 分あたりの要求数の上限（固定窓）。 */
export class MinuteLimiter {
  private windowStart = 0;
  private count = 0;
  constructor(private limit: number, private now = () => Date.now()) {}
  hit(): boolean {
    const t = this.now();
    if (t - this.windowStart >= 60_000) {
      this.windowStart = t;
      this.count = 0;
    }
    this.count++;
    return this.count <= this.limit;
  }
}
