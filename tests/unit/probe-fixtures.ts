// 03・07 の試験で共用する、手で作った性質の観測（ブラウザなし）。
import { PROBE_SUITE, type InputEffect, type ProbeReport } from "../../src/core/probes";

export const CHANGED = { pixels: 400, box: { x: 60, y: 200, w: 20, h: 100 } };
export const SAME = { pixels: 0, box: null };
export const space = (o: Partial<InputEffect> = {}): InputEffect => ({ id: "P-input-Space", kind: "key", input: "Space", declared: true, action: "ジャンプ", always: true, point: null, during: CHANGED, after: CHANGED, errors: [], ...o });
/** 問題の無い観測。 */
export function report(o: Partial<ProbeReport> = {}): ProbeReport {
  return {
    suite: PROBE_SUITE,
    environment: "chromium test",
    ms: 1,
    booted: true,
    scene: "画面 480×360、背景 #000000。要素 0 個",
    sceneEnd: "画面 480×360、背景 #000000。要素 0 個",
    motion: SAME,
    deterministic: true,
    dtZero: SAME,
    inputs: [space()],
    resize: { narrowSingleColor: false, errors: [] },
    longRun: { ms: 20000, singleColor: false, errors: [] },
    errors: [],
    skipped: [],
    ...o,
  };
}
