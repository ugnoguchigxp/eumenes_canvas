// 01：Worker スクリプトの組み立てで、作品の直前に行のずれ（__canvasEntryLine）を設定する。
import { expect, test } from "bun:test";
import { assembleWorkerScript } from "../../src/server/preview";
import { checkHostToShell } from "../../src/shared/messages.js";

test("__canvasEntryLine の値は、作品の 1 行目の添字と一致する", () => {
  const out = assembleWorkerScript("const FIRST_LINE = 1;\ncanvasApp.start((api) => ({ frame() {} }));");
  const m = /;__canvasEntryLine=(\d+);\(function \(canvasApp\) \{\n"use strict";\n/.exec(out);
  expect(m).not.toBeNull();
  expect(out.split("\n")[Number(m![1])]).toBe("const FIRST_LINE = 1;");
  expect(out).toContain(";(function (canvasApp) {");
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
