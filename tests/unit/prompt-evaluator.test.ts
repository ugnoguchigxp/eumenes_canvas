// 07：検証担当の手順書・プロンプト・PromptEvaluator（src/core/prompt-evaluator.ts）。
import { describe, expect, test } from "bun:test";
import type { EvalJudgeInput, EvalPlanInput } from "../../src/core/evaluator-port";
import type { InferenceChannel, InferenceRequest, Validate } from "../../src/core/inference";
import { loadMakerSkill } from "../../src/core/maker-skill";
import { EVALUATOR_SKILL_PATH, evaluatorSystem, judgePrompt, planPrompt, PromptEvaluator } from "../../src/core/prompt-evaluator";
import type { MakerSpec } from "../../src/core/spec";

const SPEC: MakerSpec = { requirements: [{ id: "R1", text: "Space で跳ぶ" }], controls: [{ kind: "key", input: "Space", action: "ジャンプ", always: true }] };
const PROBE_TEXT = "P-scene: 起動から 500ms（入力なし）の画面。画面 480×360";
const planIn: EvalPlanInput = { request: "Space で跳ぶ四角", conversation: [], hasBase: false, spec: SPEC, probeText: PROBE_TEXT };
const judgeIn: EvalJudgeInput = {
  request: "跳ぶ高さを上げて",
  conversation: [{ role: "user", text: "跳ぶ四角" }, { role: "assistant", text: "作りました" }],
  spec: SPEC,
  body: { title: "跳ぶ", entry: "canvasApp.start(() => ({}));" },
  probeText: PROBE_TEXT,
  scriptText: "（台本の実行は無い）",
  diffText: "追加 1 行・削除 1 行\n-a\n+b",
  evidenceIds: ["P-scene", "S1-1"],
};

describe("手順書と system", () => {
  test("手順書", () => {
    const s = loadMakerSkill(EVALUATOR_SKILL_PATH);
    expect(s.name).toBe("canvas-artwork-evaluator");
    for (const h of ["## 目的", "## 役割の分離", "## 台本を書くとき（plan）", "## 判定するとき（judge）", "## 指摘（issues）", "## 情報・道具の安全性", "## 完成条件"]) expect(s.body).toContain(h);
    for (const t of ["pass は、観測か台本の測定", "証拠の無い pass は、ホストが unknown に書き換える", "証拠の無い blocking は、ホストが minor に書き換える", "幅 480・高さ 360"]) expect(s.body).toContain(t);
  });
  test("system", () => {
    const s = evaluatorSystem();
    expect(s).toContain("# 検証の手順（canvas-artwork-evaluator）");
    for (const k of ["格子", "host-smoke", "host-probe", "heldout", "general-v1", "eval/", "commit"]) expect(s).not.toContain(k);
  });
});

describe("プロンプト", () => {
  test("台本のプロンプト", () => {
    const p = planPrompt(planIn);
    expect(p).toContain("- R1: Space で跳ぶ");
    expect(p).toContain("- キー Space：ジャンプ（いつでも効く）");
    expect(p).toContain(PROBE_TEXT);
    expect(p).not.toContain("```js");
  });
  test("判定のプロンプト", () => {
    const p = judgePrompt(judgeIn);
    expect(p).toContain("## 引用できる証拠\nP-scene, S1-1, CODE, DIFF");
    expect(p).toContain("```diff\n追加 1 行・削除 1 行\n-a\n+b\n```");
    expect(p).toContain("```js\ncanvasApp.start(() => ({}));\n```");
    expect(p).toContain("利用者: 跳ぶ四角\n制作担当: 作りました");
    expect(p).toContain("## 依頼（基準の作品に対する変更・修復）");
  });
});

test("PromptEvaluator", async () => {
  const purposes: string[] = [];
  let reply: unknown = { scripts: [] };
  const channel: InferenceChannel = {
    async complete<T>(req: InferenceRequest, validate: Validate<T>) {
      purposes.push(req.purpose);
      const r = validate(reply);
      if (!r.ok) throw new Error("形が違う");
      return r.value;
    },
  } as InferenceChannel;
  const ev = new PromptEvaluator(channel, { system: "SYS" });
  const sig = new AbortController().signal;
  await ev.plan(planIn, sig);
  reply = { verdicts: [], issues: [], summary: "" };
  await ev.judge(judgeIn, sig);
  expect(purposes).toEqual(["eval-plan", "eval-judge"]);
  reply = { verdicts: "x" };
  await expect(ev.judge(judgeIn, sig)).rejects.toThrow();
  reply = "x";
  await expect(ev.plan(planIn, sig)).rejects.toThrow();
});
