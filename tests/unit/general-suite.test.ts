// 汎用課題 general-v1 の構成の整合（docs/eval/general-v1.md）。判定そのものの妥当性は eval/general/self-test.ts で確かめる。
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECKS } from "../../eval/checks/general";
import { EVAL, GENERAL_DATASETS, GENERAL_TASKS, generalBase } from "../../eval/general/suite";

describe("general-v1 課題", () => {
  test("10 課題・分類の内訳は 新規 4／変更 3／修復 2／可視化 1", () => {
    expect(GENERAL_TASKS.length).toBe(10);
    const n = (g: string) => GENERAL_TASKS.filter((t) => t.group === g).length;
    expect([n("new"), n("modify"), n("repair"), n("nongame")]).toEqual([4, 3, 2, 1]);
    expect(new Set(GENERAL_TASKS.map((t) => t.id)).size).toBe(10);
  });

  test("課題ごとに判定・元作品・参照（または修復済み）・登録データがそろう", () => {
    for (const t of GENERAL_TASKS) {
      expect(typeof CHECKS[t.id]).toBe("function");
      expect(t.turns.length).toBeGreaterThan(0);
      if (t.group === "new") expect(t.base).toBeUndefined();
      else expect(generalBase(t)).not.toBeNull();
      if (t.group === "repair") expect(existsSync(join(EVAL, t.fixed!))).toBe(true);
      else expect(existsSync(join(EVAL, "gold/general", `${t.id}.js`))).toBe(true);
      if (t.dataRef) expect(GENERAL_DATASETS.some((d) => d.ref === t.dataRef)).toBe(true);
    }
  });

  test("制作担当に渡す文面に参照・修復済み・判定の所在が出ない", () => {
    for (const t of GENERAL_TASKS) {
      const text = t.turns.join("\n") + (t.baseTitle ?? "");
      expect(text).not.toMatch(/gold|fixed|checks|self-test/);
    }
  });

  test("凍結文書 docs/eval/general-v1.md に全課題 id が載る", () => {
    const doc = readFileSync(join(EVAL, "../docs/eval/general-v1.md"), "utf8");
    for (const t of GENERAL_TASKS) expect(doc).toContain(t.id);
  });
});
