// 07：検証のまとめ役 HostReviewer（偽の観測室と偽の検証担当、ブラウザなし）。
import { describe, expect, test } from "bun:test";
import type { EvalPlan } from "../../src/core/eval-types";
import type { EvalJudgeInput, EvalPlanInput, EvaluatorPort } from "../../src/core/evaluator-port";
import { HostReviewer } from "../../src/core/host-reviewer";
import { PROBE_SUITE, type ProbePort, type ProbeReport } from "../../src/core/probes";
import type { ReviewInput } from "../../src/core/review";
import type { ScriptResult } from "../../src/core/script-runner";
import type { MakerSpec } from "../../src/core/spec";
import { report, SAME, space } from "./probe-fixtures";

const SPEC: MakerSpec = { requirements: [{ id: "R1", text: "Space で跳ぶ" }, { id: "R2", text: "R キーでやり直す" }], controls: [{ kind: "key", input: "Space", action: "ジャンプ", always: true }] };
const sig = () => new AbortController().signal;
const BODY = { title: "跳ぶ", entry: "a\nconst H = 560;\nb" };
const BASE = { title: "跳ぶ", entry: "a\nconst H = 400;\nb" };
const MEASURED: ScriptResult[] = [
  {
    id: "S1",
    requirement: "R1",
    purpose: "跳ぶ",
    measures: [
      { id: "S1-1", t: 500, kind: "shot", label: "前", text: "…" },
      { id: "S1-2", t: 650, kind: "track", label: "跳躍中", text: "#00ff00 …" },
    ],
    errors: [],
    skipped: null,
  },
];

class FakeLab implements ProbePort {
  readonly suite = PROBE_SUITE;
  ran: EvalPlan[] = [];
  closed = false;
  constructor(private r: ProbeReport) {}
  async probe() {
    return this.r;
  }
  async runScripts(_b: unknown, _d: unknown, plan: EvalPlan) {
    this.ran.push(plan);
    return MEASURED;
  }
  async close() {
    this.closed = true;
  }
}
class FakeEvaluator implements EvaluatorPort {
  readonly label = "fake";
  plans: EvalPlanInput[] = [];
  judges: EvalJudgeInput[] = [];
  constructor(private planOut: unknown, private judgeOut: unknown) {}
  async plan(i: EvalPlanInput) {
    this.plans.push(i);
    if (this.planOut === "throw") throw new Error("plan failed");
    return this.planOut;
  }
  async judge(i: EvalJudgeInput) {
    this.judges.push(i);
    if (this.judgeOut === "throw") throw new Error("judge failed");
    return this.judgeOut;
  }
}
const PLAN = { scripts: [{ requirement: "R1", purpose: "跳ぶ", steps: [{ do: "shot", label: "前" }, { do: "tap", input: "Space" }, { do: "track", color: "#00ff00", label: "跳躍中" }] }] };
const input = (o: Partial<ReviewInput> = {}): ReviewInput => ({ request: "跳ぶ高さを上げて", conversation: [], base: null, body: BODY, data: null, spec: SPEC, mode: "full", ...o });
const brief = (fs: { source: string; severity: string; id: string }[]) => fs.map((f) => [f.source, f.severity, f.id]);
const dead = () => report({ inputs: [space({ during: SAME, after: SAME })] });

describe("HostReviewer", () => {
  test("probes", async () => {
    const ev = new FakeEvaluator(PLAN, { verdicts: [] });
    const out = await new HostReviewer(new FakeLab(dead()), ev).review(input({ mode: "probes" }), sig());
    expect(out.evaluatorCalls).toBe(0);
    expect(ev.plans.length + ev.judges.length).toBe(0);
    expect(brief(out.findings)).toEqual([["probe", "blocking", "P-input-Space"]]);
    expect(out.verdict).toBeNull();
    expect(out.suite).toBe(PROBE_SUITE);
  });

  test("full（基準あり）", async () => {
    const lab = new FakeLab(report());
    const judge = {
      verdicts: [
        { requirement: "R1", verdict: "pass", evidence: ["S1-2", "P-input-Space"], note: "y が 280 → 200" },
        { requirement: "R2", verdict: "fail", evidence: ["CODE"], note: "KeyR の処理が無い" },
      ],
      issues: [],
      summary: "",
    };
    const ev = new FakeEvaluator(PLAN, judge);
    const out = await new HostReviewer(lab, ev).review(input({ base: BASE }), sig());
    expect(out.evaluatorCalls).toBe(2);
    expect(lab.ran.length).toBe(1);
    expect(ev.plans[0].hasBase).toBe(true);
    expect(ev.judges[0].evidenceIds).toEqual(["P-scene", "P-motion", "P-dt0", "P-determinism", "P-input-Space", "P-resize", "P-long", "S1-1", "S1-2"]);
    expect(ev.judges[0].diffText).toContain("追加 1 行・削除 1 行");
    const matched = out.checks.filter((c) => c.level === "matched");
    expect(matched).toEqual([
      { id: "req:R1", level: "matched", pass: true, detail: "確認した：y が 280 → 200" },
      { id: "req:R2", level: "matched", pass: false, detail: "満たしていない：KeyR の処理が無い" },
    ]);
    expect(out.findings).toEqual([{ source: "evaluator", severity: "blocking", id: "E-req-R2", message: "[R2] 要件「R キーでやり直す」を満たしていない：KeyR の処理が無い（証拠: CODE）" }]);
    expect(out.error).toBeNull();
  });

  test("judge", async () => {
    const lab = new FakeLab(dead());
    const judge = {
      verdicts: [{ requirement: "R1", verdict: "fail", evidence: ["P-input-Space"], note: "" }],
      issues: [
        { severity: "blocking", requirement: "R1", symptom: "Space で跳ばない", evidence: ["P-input-Space"], suggestion: "dt > 0 のときだけ物理を進める" },
        { severity: "minor", symptom: "色が少し違う", evidence: [], suggestion: "" },
      ],
      summary: "",
    };
    const ev = new FakeEvaluator(PLAN, judge);
    const out = await new HostReviewer(lab, ev).review(input({ mode: "judge" }), sig());
    expect(out.evaluatorCalls).toBe(1);
    expect(ev.plans.length).toBe(0);
    expect(lab.ran.length).toBe(0);
    expect(ev.judges[0].diffText).toBeNull();
    expect(brief(out.findings)).toEqual([
      ["probe", "blocking", "P-input-Space"],
      ["evaluator", "blocking", "E-1"],
      ["evaluator", "warning", "E-2"],
    ]);
    expect(out.findings[1].message).toBe("[R1] Space で跳ばない／直し方の案：dt > 0 のときだけ物理を進める（証拠: P-input-Space）");
  });

  test("台本も判定も失敗", async () => {
    const out = await new HostReviewer(new FakeLab(dead()), new FakeEvaluator("throw", "throw")).review(input(), sig());
    expect(brief(out.findings)).toEqual([["probe", "blocking", "P-input-Space"]]);
    expect(out.error).toBe("台本の段階で失敗: plan failed ／ 判定の段階で失敗: judge failed");
    expect(out.evaluatorCalls).toBe(2);
  });

  test("宣言なし", async () => {
    const out = await new HostReviewer(new FakeLab(report()), new FakeEvaluator(PLAN, { verdicts: [] })).review(input({ spec: null }), sig());
    expect(out.evaluatorCalls).toBe(0);
    expect(out.error).toContain("宣言（spec）が無い");
  });

  test("検証担当なし", async () => {
    const out = await new HostReviewer(new FakeLab(dead()), null).review(input(), sig());
    expect(out.evaluatorCalls).toBe(0);
    expect(brief(out.findings)).toEqual([["probe", "blocking", "P-input-Space"]]);
  });

  test("起動しない作品", async () => {
    const out = await new HostReviewer(new FakeLab(report({ booted: false })), new FakeEvaluator(PLAN, { verdicts: [] })).review(input(), sig());
    expect(out.checks).toEqual([]);
    expect(out.findings).toEqual([]);
    expect(out.evaluatorCalls).toBe(0);
  });

  test("close", async () => {
    const lab = new FakeLab(report());
    await new HostReviewer(lab, null).close();
    expect(lab.closed).toBe(true);
  });
});
