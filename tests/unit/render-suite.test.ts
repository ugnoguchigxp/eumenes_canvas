// 描画方式の計測基板 render-v1 の構成の整合（docs/eval/render-v1.md）。判定そのものの妥当性は eval/render/self-test.ts で確かめる。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RENDER_CHECKS } from "../../eval/checks/render";
import { EVAL, goldEntry, MUTANTS, mutate, RENDER_TASKS } from "../../eval/render/suite";
import { checkArtwork } from "../../src/contract/artwork";
import { resolveLibraries } from "../../src/contract/libraries";

describe("render-v1 課題", () => {
  test("6 課題・群は three 1／html 1／physics 3／shader 1、すべて 1 ターンの新規", () => {
    expect(RENDER_TASKS.map((t) => t.id)).toEqual(["R-T1-cube", "R-H1-panel", "R-P1-pile", "R-P2-marbles", "R-P3-flipper", "R-V1-blackhole"]);
    const n = (g: string) => RENDER_TASKS.filter((t) => t.group === g).length;
    expect([n("three"), n("html"), n("physics"), n("shader")]).toEqual([1, 1, 3, 1]);
    for (const t of RENDER_TASKS) expect(t.turns.length).toBe(1);
  });

  test("課題ごとに判定・参照の作品がそろい、参照の作品は宣言したライブラリで契約を満たす", () => {
    for (const t of RENDER_TASKS) {
      expect(typeof RENDER_CHECKS[t.id]).toBe("function");
      const body = { title: t.id, entry: goldEntry(t.id), ...(t.libraries ? { libraries: t.libraries } : {}) };
      expect(checkArtwork(body)).toEqual({ ok: true, errors: [] });
      expect(resolveLibraries(t.libraries).length).toBe(t.libraries?.length ?? 0);
      // 宣言を外すと契約検査で落ちる（ライブラリを使う参照の作品だけ）
      if (t.libraries) expect(checkArtwork({ title: t.id, entry: body.entry }).ok).toBe(false);
    }
  });

  test("変異は参照の作品にちょうど 1 回当たり、狙う観点の名前が判定に実在する（判定は self-test で確かめる）", () => {
    for (const m of MUTANTS) {
      expect(mutate(m)).not.toBe(goldEntry(m.task));
      expect(m.fails.length).toBeGreaterThan(0);
    }
    for (const t of RENDER_TASKS) expect(MUTANTS.filter((m) => m.task === t.id).length).toBeGreaterThanOrEqual(2);
    const src = readFileSync(join(EVAL, "checks/render.ts"), "utf8");
    for (const m of MUTANTS) for (const id of m.fails) expect(src).toContain(`"${id}"`);
  });

  test("制作担当に渡す文面に参照・判定・変異・ライブラリの版の所在が出ない", () => {
    for (const t of RENDER_TASKS) expect(t.turns.join("\n")).not.toMatch(/gold|checks|self-test|mutant|変異|@0\./);
  });

  test("凍結文書と課題ファイルの課題文が一致する", () => {
    const doc = readFileSync(join(EVAL, "../docs/eval/render-v1.md"), "utf8");
    for (const t of RENDER_TASKS) {
      expect(doc).toContain(t.id);
      for (const turn of t.turns) expect(doc).toContain(turn);
    }
  });
});
