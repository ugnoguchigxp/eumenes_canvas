// プレビューオリジンの配信。固定シェルと、作品ごとの Worker スクリプトを返す。
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtworkBody } from "../contract/artwork";
import { resolveLibraries, type HostLibrary } from "../contract/libraries";

const SRC = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

export const WORKER_CSP = "default-src 'none'";

export function shellCsp(hostOrigin: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "worker-src 'self'",
    // 作品が渡す SVG（HTML を含む foreignObject）を画像として復号するため data: だけ許す。通信は伴わない。
    "img-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${hostOrigin}`,
  ].join("; ");
}

export interface LibrarySource {
  lib: HostLibrary;
  /** IIFE に束ねた本体（__canvasLibs[shim 名] に名前空間を置く）。 */
  source: string;
}

/**
 * Worker スクリプト：固定ブートストラップ → 宣言されたライブラリ → 作品本体（strict の関数本体）。
 * ライブラリは作品の引数（THREE・CANNON など）として渡す。宣言しない作品の組み立ては従来と同じ。
 */
export function assembleWorkerScript(entry: string, libs: LibrarySource[] = []): string {
  const params = ["canvasApp", ...libs.map((l) => l.lib.param)].join(", ");
  const args = ["__canvasApp", ...libs.map((l) => `__canvasLibs[${JSON.stringify(libKey(l.lib))}]`)].join(", ");
  const libText = libs.map((l) => `\n;// ${l.lib.id}（ホスト同梱）\n${l.source}\n`).join("");
  return `${read("preview/bootstrap.js")}${libText}\n;(function (${params}) {\n"use strict";\n${entry}\n}).call(undefined, ${args});\n`;
}

/** shim が名前空間を置く __canvasLibs のキー（src/preview/libs/*.js と一致）。 */
export function libKey(l: HostLibrary): string {
  return l.pkg === "three" ? "three" : l.pkg === "cannon-es" ? "cannon" : l.pkg;
}

const libCache = new Map<string, Promise<string>>();

/** node_modules の固定版から IIFE を束ねる（初回だけ、以後はメモリに保持）。版が固定と違えば失敗にする。 */
export function librarySource(lib: HostLibrary): Promise<string> {
  let p = libCache.get(lib.id);
  if (!p) {
    p = (async () => {
      const pkg = JSON.parse(readFileSync(join(SRC, "..", "node_modules", lib.pkg, "package.json"), "utf8")) as { version: string };
      if (pkg.version !== lib.version) throw new Error(`${lib.pkg} の版が固定と違う（実際 ${pkg.version}、固定 ${lib.version}）`);
      const r = await Bun.build({ entrypoints: [join(SRC, "preview/libs", lib.shim)], format: "iife", minify: true, target: "browser" });
      if (!r.success || r.outputs.length !== 1) throw new Error(`${lib.id} を束ねられない: ${r.logs.map(String).join(" / ")}`);
      return await r.outputs[0].text();
    })();
    p.catch(() => libCache.delete(lib.id));
    libCache.set(lib.id, p);
  }
  return p;
}

export async function loadLibraries(ids: readonly string[] | undefined): Promise<LibrarySource[]> {
  const libs = resolveLibraries(ids);
  return Promise.all(libs.map(async (lib) => ({ lib, source: await librarySource(lib) })));
}

interface TokenRec {
  entry: string;
  libraries: string[];
  expiresAt: number;
}

/** 作品本体を一度だけ取り出せる短命トークン。 */
export class PreviewTokens {
  private map = new Map<string, TokenRec>();
  constructor(private ttlMs = 60_000, private now = () => Date.now()) {}
  issue(body: ArtworkBody): string {
    this.sweep();
    const token = randomBytes(24).toString("base64url");
    this.map.set(token, { entry: body.entry, libraries: [...(body.libraries ?? [])], expiresAt: this.now() + this.ttlMs });
    return token;
  }
  take(token: string): string | null {
    return this.takeRun(token)?.entry ?? null;
  }
  /** 作品本体と宣言したライブラリを一度だけ取り出す。 */
  takeRun(token: string): { entry: string; libraries: string[] } | null {
    const rec = this.map.get(token);
    this.map.delete(token);
    if (!rec || rec.expiresAt < this.now()) return null;
    return { entry: rec.entry, libraries: rec.libraries };
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
  return async (req: Request): Promise<Response> => {
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
      const run = opts.tokens.takeRun(decodeURIComponent(p.slice(3)));
      if (run === null) return new Response("gone", { status: 410, headers: BASE_HEADERS });
      const libs = await loadLibraries(run.libraries);
      return new Response(assembleWorkerScript(run.entry, libs), {
        headers: { ...BASE_HEADERS, "content-type": "text/javascript; charset=utf-8", "content-security-policy": WORKER_CSP },
      });
    }
    return new Response("not found", { status: 404, headers: BASE_HEADERS });
  };
}
