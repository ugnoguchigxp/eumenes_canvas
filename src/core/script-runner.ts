// 検証担当の台本を 1 本ずつハーネスで実行し、測定を文にする（推論を使わない）。
import type { ArtworkBody } from "../contract/artwork";
import type { Script } from "./eval-types";
import type { HarnessSession } from "./harness-session";
import { blobOf, describeScene, diffShots, sceneText, type Shot } from "./pixels";

export interface Measure { id: string; t: number; kind: "shot" | "track"; label: string; text: string }
export interface ScriptResult { id: string; requirement: string | null; purpose: string; measures: Measure[]; errors: string[]; skipped: string | null }

/** 台本 1 本を実行する。途中で例外が出たら、そこまでの測定を返す。 */
export async function runScript(s: HarnessSession, body: ArtworkBody, data: unknown, script: Script): Promise<ScriptResult> {
  const r: ScriptResult = { id: script.id, requirement: script.requirement, purpose: script.purpose, measures: [], errors: [], skipped: null };
  try {
    const st = await s.start(body, data, script.seed);
    if (st.type !== "ready") {
      r.skipped = "起動しない: " + st.type;
      return r;
    }
    let lastShot: Shot | null = null;
    let n = 0;
    for (const step of script.steps) {
      switch (step.do) {
        case "wait":
          await s.advance(step.ms);
          break;
        case "keyDown":
          await s.keyDown(step.input);
          break;
        case "keyUp":
          await s.keyUp(step.input);
          break;
        case "tap":
          await s.keyDown(step.input);
          await s.advance(step.holdMs);
          await s.keyUp(step.input);
          await s.advance(0);
          break;
        case "click":
          await s.click(step.x, step.y);
          await s.advance(0);
          break;
        case "drag":
          await s.drag(step.from, step.to, step.ms);
          break;
        case "shot": {
          const shot = await s.shot();
          let text = "";
          if (lastShot) {
            const d = diffShots(lastShot, shot);
            text = `前の shot から変わった画素 ${d.pixels}${d.pixels && d.box ? `（範囲 左上(${d.box.x},${d.box.y}) 幅${d.box.w} 高さ${d.box.h}）` : ""}。`;
          }
          lastShot = shot;
          r.measures.push({ id: `${script.id}-${++n}`, t: s.t, kind: "shot", label: step.label, text: text + sceneText(describeScene(shot, 16)) });
          break;
        }
        case "track": {
          const shot = await s.shot();
          const b = blobOf(shot, parseInt(step.color.slice(1), 16));
          const text = b.pixels && b.box ? `${step.color} の画素 ${b.pixels}、左上(${b.box.x},${b.box.y}) 幅${b.box.w} 高さ${b.box.h}、中心(${b.cx},${b.cy})` : `${step.color} の画素は無い`;
          r.measures.push({ id: `${script.id}-${++n}`, t: s.t, kind: "track", label: step.label, text });
          break;
        }
      }
    }
    r.errors = (await s.errors()).slice(0, 3);
  } catch (e) {
    r.skipped = "実行中の例外: " + String((e as Error)?.message ?? e).slice(0, 200);
  }
  return r;
}

/** 測定の文。各行の先頭が証拠 id。 */
export function scriptText(results: ScriptResult[]): string {
  if (!results.length) return "（台本の実行は無い）";
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`## ${r.id}${r.requirement ? `（要件 ${r.requirement}）` : ""} ${r.purpose}`);
    if (r.skipped) lines.push(`（${r.skipped}）`);
    for (const m of r.measures) lines.push(`${m.id}: [${m.t}ms ${m.label}] ${m.text}`);
    if (r.errors.length) lines.push(`${r.id}-errors: 実行時エラー：${r.errors.join(" / ").slice(0, 600)}`);
  }
  return lines.join("\n");
}

/** 検証担当が引用できる測定の id。エラーがある台本は「<id>-errors」も足す。 */
export function scriptEvidenceIds(results: ScriptResult[]): string[] {
  const ids: string[] = [];
  for (const r of results) {
    for (const m of r.measures) ids.push(m.id);
    if (r.errors.length) ids.push(`${r.id}-errors`);
  }
  return ids;
}
