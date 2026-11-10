// 条件ごとの集計の指標（docs/agent-plan/09-eval-and-models.md §5）。general・render の grade.ts が共用する。
// 条件（実行ディレクトリの名前の頭の D・A）をまたいで足さない。

/** 実行ディレクトリの名前の照合（条件 D・A）。 */
export const RUN_DIR_RE = /^[DA]-r\d+$/;
export const condOf = (run: string) => run.split("-")[0];

/** 指標に要る、1 試行の記録と判定の組。 */
export interface GradedTrial {
  presented: boolean;
  pass: boolean;
  calls: number;
  evalCalls: number;
  hostMs: number; // ターンの hostMs の合計（応答者の待ちを除く）
  finalReview: { blocking: number } | null;
}
export interface CondMetrics {
  n: number;
  pass: number;
  /** 提示・保存まで進んだのに判定で不合格だった件数。 */
  presentedButFailed: number;
  /** finalReview がある試行で、「重い指摘 0 件」を合格の予想として判定と突き合わせた数。 */
  evaluator: { agreement: { bothPass: number; bothFail: number; missed: number; falseAlarm: number } };
  calls: { maker: { total: number; median: number | null }; evaluator: { total: number; median: number | null } };
  /** 合格した試行の hostMs。 */
  hostMs: { p50: number | null; p90: number | null };
}

/** 中央値（偶数個なら中の 2 つの平均）。 */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** 最近順位法の百分位（p は 0〜100）。 */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export function condMetrics(trials: GradedTrial[]): CondMetrics {
  const agreement = { bothPass: 0, bothFail: 0, missed: 0, falseAlarm: 0 };
  for (const t of trials) {
    if (!t.finalReview) continue;
    const predicted = t.finalReview.blocking === 0;
    if (predicted && t.pass) agreement.bothPass++;
    else if (!predicted && !t.pass) agreement.bothFail++;
    else if (predicted) agreement.missed++;
    else agreement.falseAlarm++;
  }
  const passed = trials.filter((t) => t.pass).map((t) => t.hostMs);
  return {
    n: trials.length,
    pass: trials.filter((t) => t.pass).length,
    presentedButFailed: trials.filter((t) => t.presented && !t.pass).length,
    evaluator: { agreement },
    calls: {
      maker: { total: trials.reduce((a, t) => a + t.calls, 0), median: median(trials.map((t) => t.calls)) },
      evaluator: { total: trials.reduce((a, t) => a + t.evalCalls, 0), median: median(trials.map((t) => t.evalCalls)) },
    },
    hostMs: { p50: percentile(passed, 50), p90: percentile(passed, 90) },
  };
}

/** results.json の 1 件から、指標に要る項目を取る（条件 D の古い記録には evalCalls・finalReview が無い）。 */
export function trialOf(r: { presented: boolean; calls?: number; evalCalls?: number; finalReview?: { blocking: number } | null; turns: { hostMs?: number }[] }, pass: boolean): GradedTrial {
  return { presented: r.presented, pass, calls: r.calls ?? 0, evalCalls: r.evalCalls ?? 0, hostMs: r.turns.reduce((a, t) => a + (t.hostMs ?? 0), 0), finalReview: r.finalReview ?? null };
}
