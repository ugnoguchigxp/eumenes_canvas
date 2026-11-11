import ts from "typescript";

/** ループ本体の入口に実時間の検査を足す。元の行数と保存内容は維持する。 */
export function instrumentLoops(entry: string): string {
  const source = ts.createSourceFile("artwork.js", entry, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const edits: { at: number; text: string }[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIterationStatement(node, false)) {
      const body = node.statement;
      const start = body.getStart(source);
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const check = `__canvasCheckExecution(${line + 1},${character + 1});`;
      if (ts.isBlock(body)) {
        edits.push({ at: start + 1, text: check });
      } else {
        edits.push({ at: start, text: "{" + check }, { at: body.end, text: "}" });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (edits.length === 0) return entry;
  edits.sort((a, b) => a.at - b.at);
  const parts: string[] = [];
  let previous = 0;
  for (const { at, text } of edits) {
    parts.push(entry.slice(previous, at), text);
    previous = at;
  }
  parts.push(entry.slice(previous));
  return parts.join("");
}
