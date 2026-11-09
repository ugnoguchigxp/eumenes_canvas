// 検証ホスト。ホストオリジンとプレビューオリジンの 2 つを別ポートで配信する。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkArtwork } from "../contract/artwork";
import { PreviewTokens, previewHandler } from "./preview";

const SRC = join(import.meta.dir, "..");

export interface AppOptions {
  hostPort: number;
  previewPort: number;
  hostName?: string; // 既定 localhost
  previewName?: string; // 既定 127.0.0.1（別サイトにする）
  devHarness?: boolean;
  extraRoutes?: (req: Request, url: URL, ctx: { tokens: PreviewTokens; hostOrigin: string; previewOrigin: string }) => Promise<Response | null> | Response | null;
  tokens?: PreviewTokens;
  /** HTML を返すときに追加するヘッダー（所有者 cookie の発行など）。 */
  onPage?: (req: Request) => Record<string, string>;
}

export function hostCsp(previewOrigin: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `frame-src ${previewOrigin}`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const HOST_FILES: Record<string, string> = {
  "/": "host/index.html",
  "/index.html": "host/index.html",
  "/app.js": "host/app.js",
  "/app.css": "host/app.css",
  "/preview-client.js": "host/preview-client.js",
  "/shared/messages.js": "shared/messages.js",
};
const HARNESS_FILES: Record<string, string> = {
  "/harness.html": "host/harness.html",
  "/harness.js": "host/harness.js",
  "/harness.css": "host/harness.css",
};

export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

export async function readJson(req: Request, maxBytes = 256 * 1024): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new HttpError(413, "本文が大きすぎる");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, "本文が大きすぎる");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON ではない");
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export function startApp(opts: AppOptions) {
  const hostName = opts.hostName ?? "localhost";
  const previewName = opts.previewName ?? "127.0.0.1";
  const hostOrigin = `http://${hostName}:${opts.hostPort}`;
  const previewOrigin = `http://${previewName}:${opts.previewPort}`;
  const tokens = opts.tokens ?? new PreviewTokens();
  // ハーネスはホスト側の観測（PlaywrightObserver）でも使う。作品を直接登録する /api/dev/preview は devHarness のときだけ開く。
  const files = { ...HOST_FILES, ...HARNESS_FILES };
  const securityHeaders = {
    "content-security-policy": hostCsp(previewOrigin),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
  };

  const preview = Bun.serve({ port: opts.previewPort, hostname: previewName, fetch: previewHandler({ hostOrigin, tokens }) });

  // "localhost" は実装により ::1 だけに解決されることがある（Bun は ::1 のみで待ち受けた）。
  // ブラウザがどちらのループバックへ接続しても届くよう、IPv4・IPv6 の両方で待ち受ける。origin は http://localhost:<port> のまま。
  const hostNames = hostName === "localhost" ? ["127.0.0.1", "::1"] : [hostName];
  const handler = {
    async fetch(req: Request) {
      const url = new URL(req.url);
      try {
        // 変更系 API は同一オリジンからの要求だけを受ける
        if (req.method !== "GET" && req.method !== "HEAD") {
          const origin = req.headers.get("origin");
          if (origin !== hostOrigin) throw new HttpError(403, "origin が一致しない");
        }
        const file = files[url.pathname];
        if (file && req.method === "GET") {
          const ext = file.slice(file.lastIndexOf("."));
          const headers: Record<string, string> = { ...securityHeaders, "content-type": TYPES[ext] ?? "text/plain", "cache-control": "no-store" };
          if (ext === ".html" && opts.onPage) Object.assign(headers, opts.onPage(req));
          return new Response(readFileSync(join(SRC, file), "utf8"), { headers });
        }
        if (url.pathname === "/api/config") return json({ previewOrigin, hostOrigin });
        if (opts.devHarness && url.pathname === "/api/dev/preview" && req.method === "POST") {
          const body = (await readJson(req)) as Record<string, unknown>;
          const c = checkArtwork(body);
          if (!c.ok) return json({ errors: c.errors }, 422);
          return json({ token: tokens.issue(body as { title: string; entry: string }) });
        }
        if (opts.extraRoutes) {
          const r = await opts.extraRoutes(req, url, { tokens, hostOrigin, previewOrigin });
          if (r) return r;
        }
        return json({ error: "not found" }, 404);
      } catch (e) {
        if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
        console.error(e);
        return json({ error: "internal" }, 500);
      }
    },
  };
  const hosts = hostNames.map((hostname) => Bun.serve({ port: opts.hostPort, hostname, ...handler }));

  return {
    hostOrigin,
    previewOrigin,
    tokens,
    stop() {
      for (const h of hosts) h.stop(true);
      preview.stop(true);
    },
  };
}
