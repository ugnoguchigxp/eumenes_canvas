// プレビューオリジンの配信。固定シェルと、作品ごとの Worker スクリプトを返す。
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtworkBody } from "../contract/artwork";
import { resolveLibraries, type HostLibrary } from "../contract/libraries";
import { instrumentLoops } from "./instrument-loops";

const SRC = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

export const WORKER_CSP = "default-src 'none'";

/**
 * シェルの CSP。pageMode（ページ直接モード、design.md §8）が有効なときだけ、同じオリジンの内側の iframe（/p/<token>）を許す。
 * 無効なときは従来と同じ（frame-src の指定は無く、default-src 'none' で iframe を置けない）。
 */
export function shellCsp(hostOrigin: string, pageMode = false): string {
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
    ...(pageMode ? ["frame-src 'self'"] : []),
  ].join("; ");
}

/**
 * ページ直接モードの作品の文書の CSP（10 §2 の案）。script-src は 'self'（不透明オリジンでは何にも一致しない）ではなくプレビューオリジンを明示する。
 * 通信・Worker・入れ子の iframe・フォームの送信は止める。WebRTC は CSP では止まらない（design.md §8 で受け入れた残る危険）。
 */
export function pageCsp(previewOrigin: string, hostOrigin: string): string {
  return [
    "default-src 'none'",
    `script-src ${previewOrigin}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    // frame-ancestors は祖先のすべてを確かめる（シェル＝プレビューオリジン、ホスト）
    `frame-ancestors ${previewOrigin} ${hostOrigin}`,
  ].join("; ");
}

/** 作品の文書：画面いっぱいの canvas と固定の実行時コードだけ。作品の本文は実行時コードが初期化を受けてから読み込む。 */
export function pageDocument(previewOrigin: string): string {
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}#stage{position:fixed;left:0;top:0;width:100%;height:100%;display:block}</style>
<body><canvas id="stage" width="1" height="1"></canvas><script src="${previewOrigin}/page-runtime.js"></script></body>
`;
}

/**
 * ページ直接モードの作品の本文：宣言されたライブラリ（IIFE）→ ライブラリを大域の名前（THREE・CANNON）に置く → 作品（普通のスクリプト）。
 */
export function assemblePageScript(entry: string, libs: LibrarySource[] = []): string {
  const libText = libs.map((l) => `\n;// ${l.lib.id}（ホスト同梱）\nvar __canvasLibs = window.__canvasLibs || {};\n${l.source}\n;var ${l.lib.param} = __canvasLibs[${JSON.stringify(libKey(l.lib))}];\n`).join("");
  return `${libText}\n${instrumentLoops(entry)}\n`;
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
  // 作品の直前の行で、作品の 1 行目より前の行数（ずれ）を __canvasEntryLine に入れる。桁数は行数に影響しないので、0 で数えて作り直す。
  const head = (n: number) => `${read("preview/bootstrap.js")}\n${read("preview/execution-budget.js")}${libText}\n;__canvasEntryLine=${n};(function (${params}) {\n"use strict";\n`;
  const offset = head(0).split("\n").length - 1;
  return `${head(offset)}${instrumentLoops(entry)}\n}).call(undefined, ${args});\n`;
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
  /** ページ直接モードの作品だけ "page"。 */
  runtime?: "page";
  /** ページ直接モード：作品の文書（/p/<token>）を返したか。本文（/pw/<token>）は文書の後に 1 回だけ返す。 */
  docServed?: boolean;
  expiresAt: number;
}

/** 作品本体を一度だけ取り出せる短命トークン。 */
export class PreviewTokens {
  private map = new Map<string, TokenRec>();
  constructor(private ttlMs = 60_000, private now = () => Date.now()) {}
  issue(body: ArtworkBody): string {
    this.sweep();
    const token = randomBytes(24).toString("base64url");
    const rec: TokenRec = { entry: body.entry, libraries: [...(body.libraries ?? [])], expiresAt: this.now() + this.ttlMs };
    if (body.runtime === "page") rec.runtime = "page";
    this.map.set(token, rec);
    return token;
  }
  /** トークンの方式（消費しない）。無い・期限切れは null。 */
  runtimeOf(token: string): "worker" | "page" | null {
    const rec = this.map.get(token);
    if (!rec || rec.expiresAt < this.now()) return null;
    return rec.runtime === "page" ? "page" : "worker";
  }
  /** ページ直接モード：作品の文書を 1 回だけ返してよいかを確かめて印を付ける。 */
  servePageDoc(token: string): boolean {
    const rec = this.map.get(token);
    if (!rec || rec.expiresAt < this.now() || rec.runtime !== "page" || rec.docServed) return false;
    rec.docServed = true;
    return true;
  }
  take(token: string): string | null {
    return this.takeRun(token)?.entry ?? null;
  }
  /** 作品本体と宣言したライブラリを一度だけ取り出す。 */
  takeRun(token: string): { entry: string; libraries: string[] } | null {
    const rec = this.map.get(token);
    // ページ直接モードのトークンは Worker の経路では取り出さない（消費もしない）
    if (rec?.runtime === "page") return null;
    this.map.delete(token);
    if (!rec || rec.expiresAt < this.now()) return null;
    return { entry: rec.entry, libraries: rec.libraries };
  }
  /** ページ直接モード：作品の文書を返した後に、本文を一度だけ取り出す。 */
  takePageRun(token: string): { entry: string; libraries: string[] } | null {
    const rec = this.map.get(token);
    if (!rec || rec.runtime !== "page" || !rec.docServed) return null;
    this.map.delete(token);
    if (rec.expiresAt < this.now()) return null;
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

// 不透明オリジン（sandbox="allow-scripts" の作品の文書）から読み込むスクリプトには CORP same-origin を付けられない
const { "cross-origin-resource-policy": _corp, ...PAGE_SCRIPT_HEADERS } = BASE_HEADERS;

export function previewHandler(opts: { hostOrigin: string; tokens: PreviewTokens; pageMode?: boolean }) {
  const pageMode = opts.pageMode === true;
  const shellJs = () => `const HOST_ORIGIN = ${JSON.stringify(opts.hostOrigin)};\nconst PAGE_MODE = ${pageMode};\n${read("preview/shell.js")}`;
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (req.method !== "GET") return new Response("method not allowed", { status: 405, headers: BASE_HEADERS });
    const p = url.pathname;
    if (p === "/shell.html")
      return new Response(read("preview/shell.html"), {
        headers: { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": shellCsp(opts.hostOrigin, pageMode) },
      });
    if (p === "/shell.js") return new Response(shellJs(), { headers: { ...BASE_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
    if (p === "/shell.css") return new Response(read("preview/shell.css"), { headers: { ...BASE_HEADERS, "content-type": "text/css; charset=utf-8" } });
    if (p === "/shared/messages.js")
      return new Response(read("shared/messages.js"), { headers: { ...BASE_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
    if (pageMode && p === "/page-runtime.js")
      return new Response(read("preview/execution-budget.js") + "\n" + read("preview/page-runtime.js"), { headers: { ...PAGE_SCRIPT_HEADERS, "content-type": "text/javascript; charset=utf-8" } });
    if (pageMode && p.startsWith("/p/")) {
      // 作品の文書は iframe としてだけ、1 回だけ返す
      if (req.headers.get("sec-fetch-dest") && req.headers.get("sec-fetch-dest") !== "iframe")
        return new Response("forbidden", { status: 403, headers: BASE_HEADERS });
      if (!opts.tokens.servePageDoc(decodeURIComponent(p.slice(3)))) return new Response("gone", { status: 410, headers: BASE_HEADERS });
      return new Response(pageDocument(url.origin), {
        headers: { ...BASE_HEADERS, "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(url.origin, opts.hostOrigin) },
      });
    }
    if (pageMode && p.startsWith("/pw/")) {
      // 作品の本文はスクリプトとしてだけ、文書の後に 1 回だけ返す
      if (req.headers.get("sec-fetch-dest") && req.headers.get("sec-fetch-dest") !== "script")
        return new Response("forbidden", { status: 403, headers: BASE_HEADERS });
      const run = opts.tokens.takePageRun(decodeURIComponent(p.slice(4)));
      if (run === null) return new Response("gone", { status: 410, headers: BASE_HEADERS });
      const libs = await loadLibraries(run.libraries);
      // CORS の許可は不透明オリジン（null）にだけ出す（作品の例外の内容を実行時コードが読めるようにするため）
      return new Response(assemblePageScript(run.entry, libs), {
        headers: { ...PAGE_SCRIPT_HEADERS, "content-type": "text/javascript; charset=utf-8", "access-control-allow-origin": "null" },
      });
    }
    if (p.startsWith("/w/")) {
      // Worker スクリプトは同一オリジンの Worker 起動としてだけ取得できる
      if (req.headers.get("sec-fetch-dest") && req.headers.get("sec-fetch-dest") !== "worker")
        return new Response("forbidden", { status: 403, headers: BASE_HEADERS });
      const wt = decodeURIComponent(p.slice(3));
      if (opts.tokens.runtimeOf(wt) === "page") return new Response("forbidden", { status: 403, headers: BASE_HEADERS });
      const run = opts.tokens.takeRun(wt);
      if (run === null) return new Response("gone", { status: 410, headers: BASE_HEADERS });
      const libs = await loadLibraries(run.libraries);
      return new Response(assembleWorkerScript(run.entry, libs), {
        headers: { ...BASE_HEADERS, "content-type": "text/javascript; charset=utf-8", "content-security-policy": WORKER_CSP },
      });
    }
    return new Response("not found", { status: 404, headers: BASE_HEADERS });
  };
}
