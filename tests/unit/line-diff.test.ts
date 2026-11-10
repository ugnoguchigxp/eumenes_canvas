// 07：行単位の差分（src/core/line-diff.ts）。
import { expect, test } from "bun:test";
import { lineDiff } from "../../src/core/line-diff";

test("1 行の変更と追加", () => {
  const a = Array.from({ length: 10 }, (_, i) => (i === 3 ? "const INTERVAL = 500;" : `l${i + 1}`));
  const b = [...a.map((l) => (l === "const INTERVAL = 500;" ? "const INTERVAL = 900;" : l)), "l11"];
  const d = lineDiff(a.join("\n"), b.join("\n"));
  expect([d.added, d.removed, d.truncated]).toEqual([2, 1, false]);
  expect(d.text.split("\n")).toEqual([" l2", " l3", "-const INTERVAL = 500;", "+const INTERVAL = 900;", " l5", " l6", "…", " l9", " l10", "+l11"]);
});
test("同じ文字列どうし", () => {
  expect(lineDiff("a\nb", "a\nb")).toEqual({ added: 0, removed: 0, text: "", truncated: false });
});
test("打ち切り", () => {
  const a = Array.from({ length: 300 }, (_, i) => `a${i}`).join("\n");
  const b = Array.from({ length: 300 }, (_, i) => `b${i}`).join("\n");
  const d = lineDiff(a, b, 50);
  expect(d.truncated).toBe(true);
  expect(d.text.split("\n").length).toBe(50);
});
