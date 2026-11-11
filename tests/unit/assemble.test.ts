// 01：Worker スクリプトの組み立てで、作品の直前に行のずれ（__canvasEntryLine）を設定する。
import { expect, test } from "bun:test";
import { assembleWorkerScript } from "../../src/server/preview";
import { instrumentLoops } from "../../src/server/instrument-loops";
import { checkHostToShell } from "../../src/shared/messages.js";

test("__canvasEntryLine の値は、作品の 1 行目の添字と一致する", () => {
  const out = assembleWorkerScript("const FIRST_LINE = 1;\ncanvasApp.start((api) => ({ frame() {} }));");
  const m = /;__canvasEntryLine=(\d+);\(function \(canvasApp\) \{\n"use strict";\n/.exec(out);
  expect(m).not.toBeNull();
  expect(out.split("\n")[Number(m![1])]).toBe("const FIRST_LINE = 1;");
  expect(out).toContain(";(function (canvasApp) {");
});

test("ループの本体にだけ実行時間の検査を入れ、行と制御フローを保つ", () => {
  const entry = [
    'const example = "while (true) {}";',
    "let n = 0;",
    "outer: for (let i = 0; i < 3; i++)",
    "  for (const j of [0, 1]) if (j === 0) n++; else continue outer;",
    "while (n < 4) n++;",
    "do { n++; } while (n < 5);",
    "for (const key in { a: 1 }) n++;",
    "return [n, example];",
  ].join("\n");
  const result = instrumentLoops(entry);
  const visited: number[] = [];
  expect(result.split("\n")).toHaveLength(entry.split("\n").length);
  expect(new Function("__canvasCheckExecution", result)((line: number) => visited.push(line))).toEqual([6, "while (true) {}"]);
  expect(visited).toEqual([3, 4, 4, 3, 4, 4, 3, 4, 4, 5, 6, 7]);
});

// 02：ホスト→シェルの poke（時間を進めない描き直し）の検査
test("poke は型・runId・seq・count だけを、count 1〜120 の整数で通す", () => {
  const ok = { type: "poke", runId: "r1", seq: 3, count: 30 };
  expect(checkHostToShell({ ...ok })).toEqual(ok);
  for (const count of [0, 121, 1.5]) expect(checkHostToShell({ ...ok, count })).toBeNull();
  expect(checkHostToShell({ ...ok, extra: 1 })).toBeNull();
  const { seq, ...noSeq } = ok;
  expect(checkHostToShell(noSeq)).toBeNull();
});

// 05：ホスト→シェルの start に direct（直接描画）を通す
test("start の direct は真偽値のときだけ通し、無ければ今と同じく通す", () => {
  const base = { type: "start", runId: "r1", token: "t".repeat(24), data: null, seed: 1, clock: "raf" };
  expect(checkHostToShell({ ...base, direct: true })).not.toBeNull();
  expect(checkHostToShell({ ...base, direct: "yes" })).toBeNull();
  expect(checkHostToShell({ ...base })).toEqual(base);
});
