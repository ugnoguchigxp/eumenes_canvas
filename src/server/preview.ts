// プレビューオリジンの配信。固定シェルと、作品ごとの Worker スクリプトを返す。
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtworkBody } from "../contract/artwork";

const SRC = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

export const WORKER_CSP = "default-src 'none'";

export function shellCsp(hostOrigin: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'self'",
    "img-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${hostOrigin}`,
  ].join("; ");
}

export function assembleWorkerScript(entry: string): string {
  return `${read("preview/bootstrap.js")}\n;(function (canvasApp) {\n"use strict";\n${entry}\n}).call(undefined, __canvasApp);\n`;
}

interface TokenRec {
  entry: string;
  expiresAt: number;
}

/** 作品本体を一度だけ取り出せる短命トークン。 */
export class PreviewTokens {
  private map = new Map<string, TokenRec>();
  constructor(private ttlMs = 60_000, private now = () => Date.now()) {}
  issue(body: ArtworkBody): string {
    this.sweep();
    const token = randomBytes(24).toString("base64url");
    this.map.set(token, { entry: body.entry, expiresAt: this.now() + this.ttlMs });
    return token;
  }
  take(token: string): string | null {
    const rec = this.map.get(token);
    this.map.delete(token);
    if (!rec || rec.expiresAt < this.now()) return null;
    return rec.entry;
  }
  private sweep() {
    const t = this.now();
    for (const [k, v] of this.map) if (v.expiresAt < t) this.map.delete(k);
  }
}

const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "cross-origin-resource-policy": "same-origin",
};

export function previewHandler(opts: { hostOrigin: string; tokens: PreviewTokens }) {
  const shellJs = () => `const HOST_ORIGIN = ${JSON.stringify(opts.hostOrigin)};\n${read("preview/shell.js")}`;
  return (req: Request): Response => {
    const url = new URL(req.url);
    if (req.method !== "GET") return new Response("method not allowed", { status: 405, headers: BASE_HEADERS });
    const p = url.pathname;
    if (p === "/shell.html")
      return new Response(read("preview/shell.html"), {
        headers: { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": shellCsp(opts.hostOrigin) },
      });
    if (p === "/shell.js") return new Response(shellJs(), { headers: { ...BASE_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
    if (p === "/shell.css") return new Response(read("preview/shell.css"), { headers: { ...BASE_HEADERS, "content-type": "text/css; charset=utf-8" } });
    if (p === "/shared/messages.js")
      return new Response(read("shared/messages.js"), { headers: { ...BASE_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
    if (p.startsWith("/w/")) {
      // Worker スクリプトは同一オリジンの Worker 起動としてだけ取得できる
      if (req.headers.get("sec-fetch-dest") && req.headers.get("sec-fetch-dest") !== "worker")
        return new Response("forbidden", { status: 403, headers: BASE_HEADERS });
      const entry = opts.tokens.take(decodeURIComponent(p.slice(3)));
      if (entry === null) return new Response("gone", { status: 410, headers: BASE_HEADERS });
      return new Response(assembleWorkerScript(entry), {
        headers: { ...BASE_HEADERS, "content-type": "text/javascript; charset=utf-8", "content-security-policy": WORKER_CSP },
      });
    }
    return new Response("not found", { status: 404, headers: BASE_HEADERS });
  };
}
