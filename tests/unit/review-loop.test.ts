// 08：制作のループに検証を組み込む（偽の制作担当・偽の検証、ブラウザなし）。
import { describe, expect, test } from "bun:test";
import type { ArtworkBody } from "../../src/contract/artwork";
import { ModelError, type GenerationInput, type GenerationOutput, type ModelPort } from "../../src/core/model-port";
import type { ReviewerPort, ReviewFinding, ReviewInput, ReviewMode, ReviewOutcome } from "../../src/core/review";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { FakeObserver, runToEnd } from "./support";

const A = "owner-a";
const SPEC_RAW = { requirements: ["Space で跳ぶ"], controls: [{ kind: "key", input: "Space", action: "ジャンプ", always: true }] };
const bodyOf = (n: number): ArtworkBody => ({ title: "跳ぶ", entry: `canvasApp.start((api) => ({ frame() { /* v${n} */ } }));` });
const SYNTAX: ArtworkBody = { title: "跳ぶ", entry: "canvasApp.start((api) => {\n  return { frame() { if (1 > ) {} } };\n});" };

type Reply = "throw" | ArtworkBody | undefined;
/** 試行の番号ごとに応答を決めた制作担当。渡された入力を覚える。 */
class FakeMaker implements ModelPort {
  readonly label = "fake-maker";
  inputs: GenerationInput[] = [];
  constructor(private replies: Reply[] = [], private withSpec = true) {}
  async generate(input: GenerationInput): Promise<GenerationOutput> {
    this.inputs.push(structuredClone(input));
    const r = this.replies[input.attempt];
    if (r === "throw") throw new ModelError("maker failed");
    const body = r ?? bodyOf(input.attempt);
    return { body, changes: "c", unconfirmed: [], reply: "r", ...(this.withSpec ? { spec: SPEC_RAW } : {}) };
  }
}

const BLOCK: ReviewFinding = { source: "probe", severity: "blocking", id: "P-input-Space", message: "宣言した操作 Space が画面に差を生まない" };
const BLOCK2: ReviewFinding = { source: "evaluator", severity: "blocking", id: "E-1", message: "得点が増えない" };
const WARN: ReviewFinding = { source: "evaluator", severity: "warning", id: "E-2", message: "得点の位置が依頼と違う" };
const INFO: ReviewFinding = { source: "probe", severity: "info", id: "P-long", message: "20 秒後に単色" };

/** 呼ばれた順に指摘を決めた検証。最後の決めごとを繰り返す。 */
class FakeReviewer implements ReviewerPort {
  readonly suite = "fake-review/1";
  inputs: ReviewInput[] = [];
  closed = false;
  constructor(private seq: (ReviewFinding[] | "throw")[]) {}
  async review(input: ReviewInput): Promise<ReviewOutcome> {
    this.inputs.push(input);
    const f = this.seq[Math.min(this.inputs.length - 1, this.seq.length - 1)];
    if (f === "throw") throw new Error("reviewer crashed");
    const ok = f.length === 0;
    return {
      suite: this.suite,
      environment: "fake",
      checks: [{ id: "probe:dt0", level: "advisory", pass: ok }, { id: "req:R1", level: "matched", pass: ok }],
      findings: f,
      verdict: null,
      evaluatorCalls: 2,
      ms: 1,
      error: null,
    };
  }
  async close() {
    this.closed = true;
  }
}

function setup(o: { replies?: Reply[]; withSpec?: boolean; seq?: (ReviewFinding[] | "throw")[]; mode?: ReviewMode; maxReviews?: number; runTimeoutMs?: number; observer?: FakeObserver; noReview?: boolean } = {}) {
  const maker = new FakeMaker(o.replies, o.withSpec ?? true);
  const reviewer = new FakeReviewer(o.seq ?? [[]]);
  const observer = o.observer ?? new FakeObserver();
  const svc = new CanvasService({
    store: new Store(null),
    model: maker,
    observer,
    contract: "contract",
    runTimeoutMs: o.runTimeoutMs,
    singleUser: false,
    review: o.noReview ? undefined : { reviewer, mode: o.mode ?? "full", maxReviews: o.maxReviews },
  });
  const run = () => runToEnd(svc, A, "s1", { message: "Space で跳ぶ四角" });
  const presented = (r: Awaited<ReturnType<typeof run>>) => r.candidates.find((c) => c.id === r.presentedCandidateId)!;
  return { svc, maker, reviewer, observer, run, presented };
}
let k = 0;
const key = () => `review-loop-key-${++k}`.padEnd(12, "x");

describe("制作のループと検証", () => {
  test("指摘なし", async () => {
    const t = setup({ seq: [[INFO]] });
    const r = await t.run();
    expect(r.state).toBe("presented");
    expect(r.attempts).toBe(1);
    const c = t.presented(r);
    expect(c.verification!.checks.map((x) => x.level)).toEqual(["contract", "loaded", "operated", "advisory", "matched"]);
    expect(c.verification!.requiredPassed).toBe(true);
    expect(c.spec).toEqual({ requirements: [{ id: "R1", text: "Space で跳ぶ" }], controls: [{ kind: "key", input: "Space", action: "ジャンプ", always: true }] });
    expect(c.review).toMatchObject({ mode: "full", suite: "fake-review/1", blocking: 0, evaluatorCalls: 2, error: null });
    expect(t.reviewer.inputs[0]).toMatchObject({ request: "Space で跳ぶ四角", mode: "full", base: null, spec: c.spec });
    const saved = await t.svc.save(A, c.id, { expectedRevision: 0, idempotencyKey: key() });
    expect(saved.status).toBe(200);
  });

  test("助言は保存を止めない", async () => {
    const t = setup({ seq: [[BLOCK]] });
    const r = await t.run();
    expect(r.state).toBe("presented");
    const c = t.presented(r);
    expect(c.verification!.checks.some((x) => x.level === "advisory" && !x.pass)).toBe(true);
    expect(c.verification!.requiredPassed).toBe(true);
    expect((await t.svc.save(A, c.id, { expectedRevision: 0, idempotencyKey: key() })).status).toBe(200);
  });

  test("重い指摘で直させる", async () => {
    const t = setup({ seq: [[BLOCK, WARN, INFO], []] });
    const r = await t.run();
    expect(r.attempts).toBe(2);
    expect(r.candidates.length).toBe(2);
    expect(r.presentedCandidateId).toBe(r.candidates[1].id);
    const [i0, i1] = t.maker.inputs;
    expect(i0.previousPassed).toBe(false);
    expect(i1.previousPassed).toBe(true);
    expect(i1.previous).toEqual(bodyOf(0));
    expect(i1.observations).toEqual([
      { kind: "probe", message: "[要修正] 宣言した操作 Space が画面に差を生まない" },
      { kind: "evaluator", message: "[注意] 得点の位置が依頼と違う" },
    ]);
  });

  test("warning だけ", async () => {
    const r = await setup({ seq: [[WARN]] }).run();
    expect([r.state, r.attempts]).toEqual(["presented", 1]);
  });

  test("最後まで残る（数が違う）", async () => {
    const r = await setup({ seq: [[BLOCK], [BLOCK, BLOCK2], [BLOCK, BLOCK2]] }).run();
    expect(r.attempts).toBe(3);
    expect(r.presentedCandidateId).toBe(r.candidates[0].id);
  });

  test("最後まで残る（同数）", async () => {
    const r = await setup({ seq: [[BLOCK]] }).run();
    expect(r.attempts).toBe(3);
    expect(r.presentedCandidateId).toBe(r.candidates[2].id);
  });

  test("直しの生成が失敗", async () => {
    const r = await setup({ replies: [undefined, "throw"], seq: [[BLOCK]] }).run();
    expect(r.state).toBe("presented");
    expect(r.candidates.length).toBe(1);
    expect(r.failure).toBeNull();
  });

  test("直した候補が必須の検査に落ちる", async () => {
    const observer = new FakeObserver();
    await observer.failFor(bodyOf(1), "frame: boom");
    const t = setup({ observer, seq: [[BLOCK], [BLOCK]] });
    const r = await t.run();
    expect(r.attempts).toBe(3);
    const i2 = t.maker.inputs[2];
    expect(i2.previousPassed).toBe(false);
    expect(i2.observations).toEqual([{ kind: "runtime-error", message: "frame: boom" }]);
    expect(t.reviewer.inputs.length).toBe(2);
    expect(r.candidates[1].review).toBeNull();
    expect(r.presentedCandidateId).toBe(r.candidates[2].id);
  });

  test("検証そのものが失敗", async () => {
    const t = setup({ seq: ["throw"] });
    const r = await t.run();
    expect(r.state).toBe("presented");
    expect(t.presented(r).review).toMatchObject({ blocking: 0, error: "reviewer crashed" });
  });

  test("回数の上限", async () => {
    const t = setup({ seq: [[BLOCK]], maxReviews: 1 });
    const r = await t.run();
    expect(t.reviewer.inputs.length).toBe(1);
    expect(r.candidates[1].review).toBeNull();
    expect(r.presentedCandidateId).toBe(r.candidates[1].id);
  });

  test("期限が近い", async () => {
    const t = setup({ seq: [[BLOCK]], runTimeoutMs: 30_000 });
    const r = await t.run();
    expect(r.state).toBe("presented");
    expect(t.reviewer.inputs.length).toBe(0);
    expect(t.presented(r).review).toBeNull();
  });

  test("off・検証なし", async () => {
    for (const o of [{ mode: "off" as const }, { noReview: true }]) {
      const t = setup({ ...o, withSpec: false, seq: [[BLOCK]] });
      const r = await t.run();
      expect(r.state).toBe("presented");
      expect(t.reviewer.inputs.length).toBe(0);
      const c = t.presented(r);
      expect(c.spec).toBeNull();
      expect(c.verification!.checks.map((x) => x.level)).toEqual(["contract", "loaded", "operated"]);
    }
  });

  test("必須の検査に 3 回落ちる", async () => {
    const observer = new FakeObserver();
    for (let n = 0; n < 3; n++) await observer.failFor(bodyOf(n), "frame: boom");
    const r = await setup({ observer }).run();
    expect(r.state).toBe("failed");
    expect(r.failure).toContain("修正の上限");
  });

  test("構文エラーの観測", async () => {
    const t = setup({ replies: [SYNTAX] });
    await t.run();
    const o = t.maker.inputs[1].observations[0];
    expect(o.kind).toBe("contract");
    expect(o.message).toMatch(/^構文エラー: .* ／ .*（作品の 2 行 \d+ 列）［該当行: return \{ frame\(\) \{ if \(1 > \) \{\} \} \};］$/);
  });

  test("close", async () => {
    const t = setup();
    await t.svc.close();
    expect(t.reviewer.closed).toBe(true);
  });
});
