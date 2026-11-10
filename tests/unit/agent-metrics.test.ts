// 09：条件ごとの集計の指標（eval/agent/metrics.ts）。
import { expect, test } from "bun:test";
import { condMetrics, condOf, median, percentile, RUN_DIR_RE, trialOf } from "../../eval/agent/metrics";

test("実行ディレクトリの名前", () => {
  expect(["D-r1", "A-r12", "B-r1", "D-r", "A-r1x"].map((d) => RUN_DIR_RE.test(d))).toEqual([true, true, false, false, false]);
  expect(condOf("A-r2")).toBe("A");
});
test("中央値と百分位", () => {
  expect(median([])).toBeNull();
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
  expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90);
  expect(percentile([10, 20, 30], 50)).toBe(20);
});
test("指標", () => {
  const rec = (o: object) => ({ presented: true, calls: 1, evalCalls: 2, finalReview: { blocking: 0 }, turns: [{ hostMs: 100 }, { hostMs: 50 }], ...o });
  const m = condMetrics([
    trialOf(rec({}), true), // bothPass
    trialOf(rec({ finalReview: { blocking: 1 } }), false), // bothFail
    trialOf(rec({}), false), // missed
    trialOf(rec({ finalReview: { blocking: 2 }, turns: [{ hostMs: 900 }] }), true), // falseAlarm
    trialOf(rec({ presented: false, finalReview: null, calls: 3, evalCalls: undefined }), false),
  ]);
  expect(m.evaluator.agreement).toEqual({ bothPass: 1, bothFail: 1, missed: 1, falseAlarm: 1 });
  expect(m.presentedButFailed).toBe(2);
  expect([m.n, m.pass]).toEqual([5, 2]);
  expect(m.calls).toEqual({ maker: { total: 7, median: 1 }, evaluator: { total: 8, median: 2 } });
  expect(m.hostMs).toEqual({ p50: 150, p90: 900 });
});
