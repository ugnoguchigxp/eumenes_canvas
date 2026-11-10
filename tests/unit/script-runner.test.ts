// 07：台本の測定の文と証拠 id（ブラウザなし）。実ブラウザでの runScript は prober.test.ts。
import { expect, test } from "bun:test";
import { scriptEvidenceIds, scriptText, type ScriptResult } from "../../src/core/script-runner";

test("結果が空", () => {
  expect(scriptText([])).toBe("（台本の実行は無い）");
  expect(scriptEvidenceIds([])).toEqual([]);
});
test("5.2 の例", () => {
  const results: ScriptResult[] = [
    {
      id: "S1",
      requirement: "R1",
      purpose: "Space で跳ぶ",
      measures: [
        { id: "S1-1", t: 500, kind: "shot", label: "前", text: "画面 480×360、背景 #000000。要素 2 個：…" },
        { id: "S1-2", t: 750, kind: "track", label: "跳躍中", text: "#00ff00 の画素 400、左上(60,200) 幅20 高さ20、中心(69.5,209.5)" },
      ],
      errors: ["frame: boom"],
      skipped: null,
    },
    { id: "S2", requirement: null, purpose: "", measures: [], errors: [], skipped: "時間の上限" },
  ];
  expect(scriptText(results)).toBe(
    [
      "## S1（要件 R1） Space で跳ぶ",
      "S1-1: [500ms 前] 画面 480×360、背景 #000000。要素 2 個：…",
      "S1-2: [750ms 跳躍中] #00ff00 の画素 400、左上(60,200) 幅20 高さ20、中心(69.5,209.5)",
      "S1-errors: 実行時エラー：frame: boom",
      "## S2 ",
      "（時間の上限）",
    ].join("\n"),
  );
  expect(scriptEvidenceIds(results)).toEqual(["S1-1", "S1-2", "S1-errors"]);
});
