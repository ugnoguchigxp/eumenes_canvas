// 検証担当の台本（plan）と判定（judge）の型と正規化。検証担当の出力は信頼しない（docs/agent-plan/README.md 規則 8）。
// 証拠（観測か測定の id）を引いていない「確認した」は「未確認」に、証拠の無い重い指摘は軽い指摘に、ホストが書き換える。
import { FRAME_H, FRAME_W, INPUT_RE, int, obj, str, type MakerSpec } from "./spec";

export type Step =
  | { do: "wait"; ms: number }
  | { do: "keyDown"; input: string }
  | { do: "keyUp"; input: string }
  | { do: "tap"; input: string; holdMs: number }
  | { do: "click"; x: number; y: number }
  | { do: "drag"; from: [number, number]; to: [number, number]; ms: number }
  | { do: "shot"; label: string } // 画面を測る
  | { do: "track"; color: string; label: string }; // 指定の色のまとまりを測る
export interface Script { id: string; requirement: string | null; purpose: string; seed: number; steps: Step[] }
export interface EvalPlan { scripts: Script[] }
export const PLAN_LIMITS = { scripts: 6, steps: 30, waitMsPerStep: 10_000, waitMsPerScript: 30_000, measuresPerScript: 12 } as const;

const inRange = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const point = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && inRange(v[0], 0, FRAME_W - 1) && inRange(v[1], 0, FRAME_H - 1) ? [Math.round(v[0] as number), Math.round(v[1] as number)] : null;
const input = (v: unknown): string | null => (typeof v === "string" && INPUT_RE.test(v) ? v : null);

/** 手順 1 つを正規化する。形が合わなければ null（その手順を捨てる）。 */
function normalizeStep(raw: unknown): Step | null {
  const s = obj(raw);
  if (!s) return null;
  switch (s.do) {
    case "wait": {
      const ms = int(s.ms, 0, PLAN_LIMITS.waitMsPerStep);
      return ms === null ? null : { do: "wait", ms };
    }
    case "keyDown":
    case "keyUp": {
      const i = input(s.input);
      return i === null ? null : { do: s.do, input: i };
    }
    case "tap": {
      const i = input(s.input);
      if (i === null) return null;
      return { do: "tap", input: i, holdMs: inRange(s.holdMs, 16, 2000) ? (s.holdMs as number) : 50 };
    }
    case "click": {
      const x = int(s.x, 0, FRAME_W - 1), y = int(s.y, 0, FRAME_H - 1);
      return x === null || y === null ? null : { do: "click", x, y };
    }
    case "drag": {
      const from = point(s.from), to = point(s.to);
      if (!from || !to) return null;
      return { do: "drag", from, to, ms: inRange(s.ms, 16, 2000) ? (s.ms as number) : 200 };
    }
    case "shot":
      return { do: "shot", label: str(s.label, 40) ?? "画面" };
    case "track": {
      if (typeof s.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(s.color)) return null;
      const color = s.color.toLowerCase();
      return { do: "track", color, label: str(s.label, 40) ?? color };
    }
    default:
      return null;
  }
}

const stepMs = (s: Step) => (s.do === "wait" ? s.ms : s.do === "tap" ? s.holdMs : s.do === "drag" ? s.ms : 0);

/** 台本を正規化する。測定の無い台本は捨て、残った台本に S1・S2… と id を振る。 */
export function normalizePlan(raw: unknown, spec: MakerSpec | null): EvalPlan {
  const o = obj(raw);
  if (!o || !Array.isArray(o.scripts)) return { scripts: [] };
  const reqIds = new Set((spec?.requirements ?? []).map((r) => r.id));
  const scripts: Script[] = [];
  for (const rs of o.scripts) {
    if (scripts.length >= PLAN_LIMITS.scripts) break;
    const so = obj(rs);
    if (!so || !Array.isArray(so.steps)) continue;
    const steps: Step[] = [];
    let ms = 0, measures = 0;
    for (const raw of so.steps) {
      const st = normalizeStep(raw);
      if (!st) continue;
      const isMeasure = st.do === "shot" || st.do === "track";
      if (isMeasure && measures >= PLAN_LIMITS.measuresPerScript) continue;
      if (ms + stepMs(st) > PLAN_LIMITS.waitMsPerScript) break;
      ms += stepMs(st);
      if (isMeasure) measures++;
      steps.push(st);
      if (steps.length >= PLAN_LIMITS.steps) break;
    }
    if (!measures) continue;
    scripts.push({
      id: `S${scripts.length + 1}`,
      requirement: typeof so.requirement === "string" && reqIds.has(so.requirement) ? so.requirement : null,
      purpose: typeof so.purpose === "string" ? so.purpose.slice(0, 120) : "",
      seed: int(so.seed, 0, 2 ** 32 - 1) ?? 1,
      steps,
    });
  }
  return { scripts };
}

export type VerdictValue = "pass" | "fail" | "unknown";
export interface RequirementVerdict { requirement: string; verdict: VerdictValue; evidence: string[]; note: string }
export interface Issue { severity: "blocking" | "minor"; requirement: string | null; symptom: string; evidence: string[]; suggestion: string }
export interface EvalVerdict { verdicts: RequirementVerdict[]; issues: Issue[]; summary: string }
/** コードを読んだだけの根拠。fail・指摘には使えるが、pass の根拠にはならない。 */
export const CODE_EVIDENCE = new Set(["CODE", "DIFF"]);

/** 判定を正規化する。甘い判定を止める中心の規則。 */
export function normalizeVerdict(raw: unknown, spec: MakerSpec, evidenceIds: ReadonlySet<string>): EvalVerdict {
  const o = obj(raw);
  const reqIds = new Set(spec.requirements.map((r) => r.id));
  const evidence = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const e of v) {
      if (typeof e !== "string" || !(evidenceIds.has(e) || CODE_EVIDENCE.has(e)) || out.includes(e)) continue;
      out.push(e);
      if (out.length >= 8) break;
    }
    return out;
  };
  const byReq = new Map<string, RequirementVerdict>();
  if (o && Array.isArray(o.verdicts))
    for (const rv of o.verdicts) {
      const v = obj(rv);
      if (!v || typeof v.requirement !== "string" || !reqIds.has(v.requirement) || byReq.has(v.requirement)) continue;
      let verdict: VerdictValue = v.verdict === "pass" || v.verdict === "fail" ? v.verdict : "unknown";
      const ev = evidence(v.evidence);
      let note = typeof v.note === "string" ? v.note : "";
      if (verdict === "pass" && !ev.some((e) => !CODE_EVIDENCE.has(e))) {
        verdict = "unknown";
        note = "（観測の証拠の引用が無いため未確認に変更）" + note;
      } else if (verdict === "fail" && ev.length === 0) {
        verdict = "unknown";
        note = "（証拠の引用が無いため未確認に変更）" + note;
      }
      byReq.set(v.requirement, { requirement: v.requirement, verdict, evidence: ev, note: note.slice(0, 300) });
    }
  const verdicts = spec.requirements.map((r) => byReq.get(r.id) ?? { requirement: r.id, verdict: "unknown" as const, evidence: [], note: "（判定なし）" });
  const issues: Issue[] = [];
  if (o && Array.isArray(o.issues))
    for (const ri of o.issues) {
      if (issues.length >= 8) break;
      const i = obj(ri);
      const symptom = str(i?.symptom, 300);
      if (!i || !symptom) continue;
      const ev = evidence(i.evidence);
      issues.push({
        severity: i.severity === "blocking" && ev.length > 0 ? "blocking" : "minor",
        requirement: typeof i.requirement === "string" && reqIds.has(i.requirement) ? i.requirement : null,
        symptom,
        evidence: ev,
        suggestion: typeof i.suggestion === "string" ? i.suggestion.slice(0, 300) : "",
      });
    }
  return { verdicts, issues, summary: o && typeof o.summary === "string" ? o.summary.slice(0, 400) : "" };
}
