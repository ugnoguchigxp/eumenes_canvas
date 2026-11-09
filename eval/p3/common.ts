// P3 の条件に共通する部品：作品の検査（製品と同じ契約検査＋ホスト観測）と、提出の上限。
import type { ArtworkBody } from "../../src/contract/artwork";
import { checkArtwork } from "../../src/contract/artwork";
import type { ObserverPort } from "../../src/core/observer";
import type { CheckResult, Observation } from "../../src/core/types";

export const SUBMISSIONS_PER_TURN = 3; // 初回＋修正 2 回（plan.md §3.2）
export const SUBMISSIONS_PER_TASK = 6;
export const MAX_ENTRY_BYTES = 128 * 1024;

export interface SmokeResult {
  requiredPassed: boolean;
  checks: CheckResult[];
  observations: Observation[];
}

/** 製品の CanvasService と同じ順の検査：契約 → データの登録 → ブラウザ観測（host-smoke/1）。 */
export async function smoke(observer: ObserverPort, body: ArtworkBody, datasets: Map<string, unknown>, signal: AbortSignal): Promise<SmokeResult> {
  const c = checkArtwork(body);
  if (!c.ok) return { requiredPassed: false, checks: [{ id: "contract", level: "contract", pass: false, detail: c.errors.join(" / ") }], observations: c.errors.map((m) => ({ kind: "contract" as const, message: m })) };
  if (body.dataRef && !datasets.has(body.dataRef))
    return { requiredPassed: false, checks: [{ id: "contract", level: "contract", pass: false, detail: "未登録の dataRef" }], observations: [{ kind: "contract", message: `未登録の dataRef: ${body.dataRef}` }] };
  const obs = await observer.observe(body, body.dataRef ? (datasets.get(body.dataRef) ?? null) : null, signal);
  const checks: CheckResult[] = [{ id: "contract", level: "contract", pass: true }, ...obs.checks];
  const levels = ["contract", "loaded", "operated"].every((l) => checks.some((k) => k.level === l));
  return { requiredPassed: levels && checks.filter((k) => k.level !== "matched").every((k) => k.pass), checks, observations: obs.observations };
}

/** 課題ごとの提出の数え方（3 条件で同じ）。 */
export class SubmissionBudget {
  turn = 0;
  task = 0;
  startTurn() {
    this.turn = 0;
  }
  /** 提出してよければ数えて true。 */
  take(): boolean {
    if (this.turn >= SUBMISSIONS_PER_TURN || this.task >= SUBMISSIONS_PER_TASK) return false;
    this.turn++;
    this.task++;
    return true;
  }
}

export const describeChecks = (r: SmokeResult) => r.checks.map((k) => `${k.id}=${k.pass ? "合格" : "不合格"}${k.detail ? `（${k.detail}）` : ""}`).join(", ");
