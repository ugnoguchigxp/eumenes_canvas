// 作品契約 v1：単一の自己完結した JavaScript エントリと、別に渡す小さな入力 JSON。
// 任意で、ホストが同梱する固定版ライブラリ（src/contract/libraries.ts）を宣言できる。
import { HOST_LIBRARIES, MAX_LIBRARIES, libraryById, resolveLibraries } from "./libraries";
export const CONTRACT_VERSION = "canvas-artwork/1";
export const MAX_ENTRY_BYTES = 128 * 1024;
export const MAX_DATA_BYTES = 64 * 1024;
export const MAX_TITLE_CHARS = 80;

export interface ArtworkBody {
  title: string;
  entry: string;
  /** ホストが登録した読み取り専用データの参照（任意）。 */
  dataRef?: string;
  /** ホストが同梱する固定版ライブラリの id（任意。例 "three@0.187.0"）。 */
  libraries?: string[];
}
const DATA_REF = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface ContractResult {
  ok: boolean;
  errors: string[];
}

const enc = new TextEncoder();

export function utf8Bytes(s: string): number {
  return enc.encode(s).length;
}

/** 文字列が well-formed な UTF-16（孤立サロゲートなし）か。 */
function wellFormed(s: string): boolean {
  return (s as unknown as { isWellFormed?: () => boolean }).isWellFormed?.() ?? !/[\uD800-\uDFFF]/.test(s);
}

export function checkArtwork(body: unknown): ContractResult {
  const errors: string[] = [];
  if (!body || typeof body !== "object") return { ok: false, errors: ["作品はオブジェクトでなければならない"] };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => k !== "title" && k !== "entry" && k !== "dataRef" && k !== "libraries");
  let libs: string[] = [];
  if (b.libraries !== undefined) {
    if (!Array.isArray(b.libraries) || b.libraries.some((x) => typeof x !== "string")) errors.push("libraries は文字列の配列");
    else {
      libs = b.libraries as string[];
      const unknown = libs.filter((x) => !libraryById(x));
      if (unknown.length) errors.push(`未提供のライブラリ: ${unknown.join(", ")}（提供されるのは ${HOST_LIBRARIES.map((l) => l.id).join(", ")}）`);
      if (new Set(libs).size !== libs.length) errors.push("libraries に重複がある");
      if (libs.length > MAX_LIBRARIES) errors.push(`libraries は ${MAX_LIBRARIES} 個まで`);
    }
  }
  if (b.dataRef !== undefined && (typeof b.dataRef !== "string" || !DATA_REF.test(b.dataRef))) errors.push("dataRef の形式が不正");
  if (extra.length) errors.push(`未定義の項目: ${extra.join(", ")}`);
  if (typeof b.title !== "string" || b.title.trim() === "") errors.push("title は空でない文字列");
  else if ([...b.title].length > MAX_TITLE_CHARS) errors.push(`title は ${MAX_TITLE_CHARS} 文字以内`);
  if (typeof b.entry !== "string" || b.entry.trim() === "") {
    errors.push("entry は空でない文字列");
    return { ok: false, errors };
  }
  const entry = b.entry;
  if (!wellFormed(entry)) errors.push("entry に不正な UTF-16 がある");
  const bytes = utf8Bytes(entry);
  if (bytes > MAX_ENTRY_BYTES) errors.push(`entry は UTF-8 で ${MAX_ENTRY_BYTES} バイト以内（実際 ${bytes}）`);
  else {
    // 実行せずに構文だけを確認する。関数本体として解析できない場合（import 宣言など）は拒否する。
    try {
      // 実行時と同じ引数（canvasApp と宣言したライブラリ）で解析する。引数と同名の let・const は構文エラーになる。
      new Function("canvasApp", ...resolveLibraries(libs).map((l) => l.param), `"use strict";\n${entry}`);
    } catch (e) {
      errors.push(`構文エラー: ${(e as Error).message}`);
    }
    if (/\bimport\s*\(/.test(entry)) errors.push("動的 import は使えない");
    if (/\bimportScripts\b/.test(entry)) errors.push("importScripts は使えない");
    // 宣言せずに同梱ライブラリの名前を使うと実行時に未定義になる。先に契約の検査で知らせる。
    for (const l of HOST_LIBRARIES)
      if (!libs.includes(l.id) && new RegExp(`\\b${l.param}\\s*\\.`).test(entry) && !new RegExp(`\\b(?:const|let|var|function|class)\\s+${l.param}\\b`).test(entry)) errors.push(`${l.param} を使うには libraries に "${l.id}" を宣言する`);
  }
  return { ok: errors.length === 0, errors };
}

export function checkData(data: unknown): ContractResult {
  let s: string | undefined;
  try {
    s = JSON.stringify(data ?? null);
  } catch {
    return { ok: false, errors: ["入力データは JSON に変換できなければならない"] };
  }
  const bytes = utf8Bytes(s);
  if (bytes > MAX_DATA_BYTES) return { ok: false, errors: [`入力データは ${MAX_DATA_BYTES} バイト以内（実際 ${bytes}）`] };
  return { ok: true, errors: [] };
}

/** ホストが保存した実体と契約の版から digest を計算する。 */
export async function artworkDigest(body: ArtworkBody): Promise<string> {
  // libraries を宣言しない作品の digest は従来と同じ（保存済み作品の digest を保つ）。
  const base = { contract: CONTRACT_VERSION, title: body.title, entry: body.entry, dataRef: body.dataRef ?? null };
  const canonical = JSON.stringify(body.libraries && body.libraries.length ? { ...base, libraries: resolveLibraries(body.libraries).map((l) => l.id) } : base);
  const h = await crypto.subtle.digest("SHA-256", enc.encode(canonical));
  return "sha256:" + Buffer.from(h).toString("hex");
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Buffer.from(h).toString("hex");
}
