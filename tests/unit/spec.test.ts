// 06：制作担当の宣言（要件と操作）の正規化（src/core/spec.ts）。
import { expect, test } from "bun:test";
import { int, normalizeSpec, obj, str } from "../../src/core/spec";

test("形の合う部分だけ残し、要件の id はホストが振る", () => {
  const r = normalizeSpec({
    requirements: [{ id: "x", text: " Space で跳ぶ " }, "R キーでやり直す", { text: "" }, 5],
    controls: [
      { kind: "key", input: "Space", action: "ジャンプ", always: true },
      { kind: "key", input: "Space", action: "重複", always: true },
      { kind: "key", input: "Escape", action: "使えないキー", always: true },
      { kind: "key", input: "KeyR", action: "やり直す" },
      { kind: "pointer", action: "押して選ぶ", always: "yes" },
      { kind: "pointer", action: "2 つ目のポインター", always: true },
      { kind: "touch", action: "未対応の種類", always: true },
    ],
  });
  expect(r).toEqual({
    requirements: [{ id: "R1", text: "Space で跳ぶ" }, { id: "R2", text: "R キーでやり直す" }],
    controls: [
      { kind: "key", input: "Space", action: "ジャンプ", always: true },
      { kind: "key", input: "KeyR", action: "やり直す", always: false },
      { kind: "pointer", input: "pointer", action: "押して選ぶ", always: false },
    ],
  });
});

test("要件が無い・形が違うときは null、操作が無ければ空の配列", () => {
  expect(normalizeSpec(null)).toBeNull();
  expect(normalizeSpec({ requirements: [] })).toBeNull();
  expect(normalizeSpec({ requirements: ["a"] })).toEqual({ requirements: [{ id: "R1", text: "a" }], controls: [] });
});

test("上限で切る（要件 20 個・300 文字、操作 12 個・100 文字）", () => {
  const r = normalizeSpec({
    requirements: Array.from({ length: 25 }, (_, i) => (i === 0 ? "x".repeat(400) : `要件 ${i}`)),
    controls: Array.from({ length: 15 }, (_, i) => ({ kind: "key", input: `Key${String.fromCharCode(65 + i)}`, action: i === 0 ? "a".repeat(150) : "動く", always: true })),
  })!;
  expect(r.requirements.length).toBe(20);
  expect(r.requirements[0].text.length).toBe(300);
  expect(r.controls.length).toBe(12);
  expect(r.controls[0].action.length).toBe(100);
});

test("小さな関数 str・obj・int", () => {
  expect(str("  a  ", 10)).toBe("a");
  expect(str("   ", 10)).toBeNull();
  expect(str(1, 10)).toBeNull();
  expect(str("abcdef", 3)).toBe("abc");
  expect(obj({ a: 1 })).toEqual({ a: 1 });
  expect(obj([])).toBeNull();
  expect(obj(null)).toBeNull();
  expect(int(2.6, 0, 10)).toBe(3);
  expect(int(11, 0, 10)).toBeNull();
  expect(int(Infinity, 0, 10)).toBeNull();
  expect(int("3", 0, 10)).toBeNull();
});
