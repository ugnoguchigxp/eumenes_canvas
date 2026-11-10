// 07：検証担当の台本と判定の正規化（src/core/eval-types.ts）。
import { describe, expect, test } from "bun:test";
import { normalizePlan, normalizeVerdict } from "../../src/core/eval-types";
import type { MakerSpec } from "../../src/core/spec";

const SPEC: MakerSpec = { requirements: [{ id: "R1", text: "Space で跳ぶ" }, { id: "R2", text: "得点が増える" }], controls: [] };

describe("台本の正規化", () => {
  test("台本の正規化", () => {
    const p = normalizePlan(
      {
        scripts: [
          { requirement: "R1", purpose: "跳ぶ", steps: [{ do: "wait", ms: 500 }, { do: "shot", label: "前" }, { do: "tap", input: "Space" }, { do: "wait", ms: 200 }, { do: "track", color: "#00FF00", label: "自機" }, { do: "eval" }, { do: "click", x: 9999, y: 10 }] },
          { requirement: "R1", purpose: "測らない", steps: [{ do: "wait", ms: 100 }] },
          { requirement: "R9", purpose: "引く", steps: [{ do: "drag", from: [10, 10], to: [100, 50] }, { do: "shot" }, { do: "wait", ms: 20000 }, { do: "wait", ms: 9000 }, { do: "wait", ms: 9000 }, { do: "shot", label: "切られる" }] },
          "台本",
        ],
      },
      SPEC,
    );
    expect(p.scripts.length).toBe(2);
    const [a, b] = p.scripts;
    expect([a.id, a.requirement, a.seed, a.steps.length]).toEqual(["S1", "R1", 1, 5]);
    expect(a.steps[2]).toEqual({ do: "tap", input: "Space", holdMs: 50 });
    expect(a.steps[4]).toEqual({ do: "track", color: "#00ff00", label: "自機" });
    expect([b.id, b.requirement]).toEqual(["S2", null]);
    expect(b.steps).toEqual([
      { do: "drag", from: [10, 10], to: [100, 50], ms: 200 },
      { do: "shot", label: "画面" },
      { do: "wait", ms: 9000 },
      { do: "wait", ms: 9000 },
      { do: "shot", label: "切られる" },
    ]);
  });
  test("本数の上限", () => {
    const scripts = Array.from({ length: 10 }, () => ({ requirement: "R1", purpose: "", steps: [{ do: "shot" }] }));
    expect(normalizePlan({ scripts }, SPEC).scripts.length).toBe(6);
  });
  test("時間の上限", () => {
    const steps = [{ do: "wait", ms: 10000 }, { do: "wait", ms: 10000 }, { do: "wait", ms: 10000 }, { do: "wait", ms: 1 }, { do: "shot" }];
    expect(normalizePlan({ scripts: [{ requirement: "R1", purpose: "", steps }] }, SPEC).scripts.length).toBe(0);
  });
  test("形の違う入力", () => {
    expect(normalizePlan(null, SPEC)).toEqual({ scripts: [] });
  });
});

describe("判定の正規化", () => {
  const ids = new Set(["P-input-Space", "S1-2"]);
  test("判定の正規化", () => {
    const v = normalizeVerdict(
      {
        verdicts: [
          { requirement: "R1", verdict: "pass", evidence: ["CODE"], note: "" },
          { requirement: "R2", verdict: "fail", evidence: ["CODE"], note: "" },
          { requirement: "R7", verdict: "pass", evidence: ["S1-2"], note: "" },
        ],
        issues: [
          { severity: "blocking", requirement: "R1", symptom: "跳ばない", evidence: ["P-input-Space", "P-nope"], suggestion: "" },
          { severity: "blocking", symptom: "止まる", evidence: [], suggestion: "" },
          { severity: "weird", symptom: "色", evidence: ["S1-2"], suggestion: "" },
          { severity: "minor", symptom: "", evidence: [], suggestion: "" },
        ],
        summary: "",
      },
      SPEC,
      ids,
    );
    expect(v.verdicts.length).toBe(2);
    expect(v.verdicts[0].verdict).toBe("unknown");
    expect(v.verdicts[0].note.startsWith("（観測の証拠の引用が無いため未確認に変更）")).toBe(true);
    expect([v.verdicts[1].verdict, v.verdicts[1].evidence]).toEqual(["fail", ["CODE"]]);
    expect(v.issues.map((i) => [i.severity, i.requirement, i.evidence])).toEqual([
      ["blocking", "R1", ["P-input-Space"]],
      ["minor", null, []],
      ["minor", null, ["S1-2"]],
    ]);
  });
  test("観測の証拠つきの pass", () => {
    const v = normalizeVerdict({ verdicts: [{ requirement: "R1", verdict: "pass", evidence: ["S1-2", "CODE"], note: "" }], issues: [], summary: "" }, SPEC, ids);
    expect(v.verdicts[0].verdict).toBe("pass");
    expect([v.verdicts[1].verdict, v.verdicts[1].note]).toEqual(["unknown", "（判定なし）"]);
  });
  test("形の違う入力", () => {
    expect(normalizeVerdict("判定", SPEC, ids).verdicts.every((r) => r.verdict === "unknown")).toBe(true);
  });
});
