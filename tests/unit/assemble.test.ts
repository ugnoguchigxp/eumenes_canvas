// 01：Worker スクリプトの組み立てで、作品の直前に行のずれ（__canvasEntryLine）を設定する。
import { expect, test } from "bun:test";
import { assembleWorkerScript } from "../../src/server/preview";

test("__canvasEntryLine の値は、作品の 1 行目の添字と一致する", () => {
  const out = assembleWorkerScript("const FIRST_LINE = 1;\ncanvasApp.start((api) => ({ frame() {} }));");
  const m = /;__canvasEntryLine=(\d+);\(function \(canvasApp\) \{\n"use strict";\n/.exec(out);
  expect(m).not.toBeNull();
  expect(out.split("\n")[Number(m![1])]).toBe("const FIRST_LINE = 1;");
  expect(out).toContain(";(function (canvasApp) {");
});

