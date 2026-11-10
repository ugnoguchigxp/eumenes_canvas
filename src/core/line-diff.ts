// 行単位の差分。変更・修復の依頼で「依頼された点以外を変えていないか」を検証担当が見るために使う。

export interface LineDiff { added: number; removed: number; text: string; truncated: boolean }

const MAX_TABLE_LINES = 4000;
const LINE_CHARS = 200;
const CONTEXT = 2;

/** 最長共通部分列で行ごとに「同じ・削除・追加」を決め、変更のあった行と前後 2 行だけを並べる。同じ長さなら削除を先に出す。 */
export function lineDiff(before: string, after: string, maxLines = 200): LineDiff {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  if (a.length > MAX_TABLE_LINES || b.length > MAX_TABLE_LINES) return { added: b.length, removed: a.length, text: "（行数が多いため差分を省略）", truncated: true };
  const n = a.length, m = b.length, W = m + 1;
  // L[i][j] = a[i..] と b[j..] の最長共通部分列の長さ
  const L = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i * W + j] = a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const ops: { t: " " | "-" | "+"; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ t: " ", s: a[i] });
      i++;
      j++;
    } else if (i < n && (j >= m || L[(i + 1) * W + j] >= L[i * W + j + 1])) ops.push({ t: "-", s: a[i++] });
    else ops.push({ t: "+", s: b[j++] });
  }
  const added = ops.filter((o) => o.t === "+").length, removed = ops.filter((o) => o.t === "-").length;
  if (!added && !removed) return { added: 0, removed: 0, text: "", truncated: false };
  const show = new Uint8Array(ops.length);
  ops.forEach((o, k) => {
    if (o.t !== " ") for (let d = Math.max(0, k - CONTEXT); d <= Math.min(ops.length - 1, k + CONTEXT); d++) show[d] = 1;
  });
  const lines: string[] = [];
  let truncated = false, gap = false;
  for (let k = 0; k < ops.length; k++) {
    if (!show[k]) {
      gap = lines.length > 0; // 先頭には入れない
      continue;
    }
    const pending = gap ? ["…"] : [];
    gap = false;
    for (const l of [...pending, (ops[k].t + ops[k].s).slice(0, LINE_CHARS)]) {
      if (lines.length >= maxLines) { truncated = true; break; }
      lines.push(l);
    }
    if (truncated) break;
  }
  if (!truncated && gap) {
    if (lines.length >= maxLines) truncated = true;
    else lines.push("…");
  }
  return { added, removed, text: lines.join("\n"), truncated };
}
