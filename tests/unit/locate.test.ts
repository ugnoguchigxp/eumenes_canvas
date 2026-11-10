// 01：制作担当に返すエラーの文に、作品の該当行を足す（src/core/locate.ts）。
import { describe, expect, test } from "bun:test";
import { syntaxErrorDetail, withSourceLine } from "../../src/core/locate";

const entry = ["canvasApp.start((api) => ({", "  frame() {", "    api.ctx.fillRect(bal.x, 0, 1, 1);", "  },", "}));"].join("\n");
const broken = "canvasApp.start((api) => {\n  let x = 1;\n  return { frame(t, dt) { if (x > ) {} } };\n});";

describe("withSourceLine", () => {
  test("該当行を足す", () => {
    expect(withSourceLine("frame: bal is not defined（作品の 3 行 22 列）", entry)).toBe(
      "frame: bal is not defined（作品の 3 行 22 列）［該当行: api.ctx.fillRect(bal.x, 0, 1, 1);］",
    );
  });
  test("2 か所とも足す", () => {
    expect(withSourceLine("[キー入力の段階で発生] input: x（作品の 2 行 1 列） / frame: y（作品の 3 行 5 列）", entry)).toBe(
      "[キー入力の段階で発生] input: x（作品の 2 行 1 列）［該当行: frame() {］ / frame: y（作品の 3 行 5 列）［該当行: api.ctx.fillRect(bal.x, 0, 1, 1);］",
    );
  });
  test("位置が無い", () => {
    expect(withSourceLine("frame: boom", entry)).toBe("frame: boom");
  });
  test("行が無い", () => {
    expect(withSourceLine("frame: boom（作品の 99 行 1 列）", entry)).toBe("frame: boom（作品の 99 行 1 列）");
  });
  test("CRLF の作品でも行を取り、160 文字で切る。空白だけの行は足さない", () => {
    const long = "a".repeat(300);
    expect(withSourceLine("x（作品の 2 行 1 列）", `l1\r\n  ${long}  \r\n`)).toBe(`x（作品の 2 行 1 列）［該当行: ${"a".repeat(160)}］`);
    expect(withSourceLine("x（作品の 2 行 1 列）", "l1\n   \nl3")).toBe("x（作品の 2 行 1 列）");
  });
});

describe("syntaxErrorDetail", () => {
  test("正しい作品", () => {
    expect(syntaxErrorDetail(entry)).toBeNull();
  });
  test("構文エラー", () => {
    const r = syntaxErrorDetail(broken);
    expect(r).not.toBeNull();
    expect(r!).toContain("（作品の 3 行 ");
    expect(r!).toContain("［該当行: return { frame(t, dt) { if (x > ) {} } };］");
  });
  test("1 行目の構文エラー", () => {
    expect(syntaxErrorDetail("const a = (;")!).toContain("（作品の 1 行 ");
  });
});
