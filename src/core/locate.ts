// 制作担当に返すエラーの文に、作品の該当行を足す（推論を使わない。純粋な関数）。
// 実行時エラーの位置「（作品の N 行 M 列）」はブートストラップが文に入れる。構文エラーの位置は Bun.Transpiler で調べる。

const POS = /（作品の (\d+) 行 (\d+) 列）/g;
const LINE_CHARS = 160;

function entryLines(entry: string): string[] {
  return entry.replace(/\r\n/g, "\n").split("\n");
}

/** 文の中の「（作品の N 行 M 列）」すべての直後に「［該当行: <作品の N 行目>］」を足す。行が無い・空白だけなら足さない。 */
export function withSourceLine(message: string, entry: string): string {
  const lines = entryLines(String(entry ?? ""));
  return message.replace(POS, (all: string, n: string) => {
    const text = (lines[Number(n) - 1] ?? "").trim().slice(0, LINE_CHARS);
    return text ? `${all}［該当行: ${text}］` : all;
  });
}

interface TranspilePosition {
  line?: unknown;
  column?: unknown;
  lineText?: unknown;
}

/** 作品本体の構文エラーの位置と該当行。エラーが無い・位置が取れない・Bun 以外の環境では null。 */
export function syntaxErrorDetail(entry: string): string | null {
  const B = (globalThis as { Bun?: { Transpiler?: new (o: { loader: "js" }) => { transformSync(code: string): string } } }).Bun;
  if (!B?.Transpiler) return null;
  try {
    // 配信と同じく strict の関数本体として読む（前に 2 行足す）
    new B.Transpiler({ loader: "js" }).transformSync('(function () {\n"use strict";\n' + entry + "\n})");
    return null;
  } catch (e) {
    const err = ((e as { errors?: unknown[] })?.errors?.[0] ?? e) as { message?: unknown; position?: TranspilePosition | null };
    const pos = err?.position;
    if (!pos || typeof pos.line !== "number") return null;
    const line = pos.line - 2;
    if (line < 1) return null;
    const text = String(pos.lineText ?? "").trim().slice(0, LINE_CHARS);
    return `${String(err.message ?? "")}（作品の ${line} 行 ${String(pos.column)} 列）［該当行: ${text}］`;
  }
}
