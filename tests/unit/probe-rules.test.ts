// 03：性質の観測 host-probe/1 の規則と文（ブラウザなし）。
import { describe, expect, test } from "bun:test";
import { probeChecks, probeEvidenceIds, probeFindings, probeText, PROBE_SUITE, type InputEffect, type ProbeReport } from "../../src/core/probes";

const CHANGED = { pixels: 400, box: { x: 60, y: 200, w: 20, h: 100 } };
const SAME = { pixels: 0, box: null };
const space = (o: Partial<InputEffect> = {}): InputEffect => ({ id: "P-input-Space", kind: "key", input: "Space", declared: true, action: "ジャンプ", always: true, point: null, during: CHANGED, after: CHANGED, errors: [], ...o });
/** 問題の無い観測。 */
function report(o: Partial<ProbeReport> = {}): ProbeReport {
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
const brief = (r: ProbeReport) => probeFindings(r).map((f) => [f.severity, f.id]);

describe("性質の観測の規則", () => {
  test("問題なし", () => {
    const r = report();
    expect(probeFindings(r)).toEqual([]);
    const c = probeChecks(r);
    expect(c.map((x) => x.id)).toEqual(["probe:no-error", "probe:dt0-stable", "probe:deterministic", "probe:input:Space", "probe:resize", "probe:long-run"]);
    expect(c.every((x) => x.pass && x.level === "advisory")).toBe(true);
  });
  test("宣言したキーに効果なし", () => {
    const r = report({ inputs: [space({ during: SAME, after: SAME })] });
    expect(brief(r)).toEqual([["blocking", "P-input-Space"]]);
    expect(probeFindings(r)[0].message).toContain("Space：ジャンプ");
    expect(probeChecks(r).find((x) => x.id === "probe:input:Space")!.pass).toBe(false);
  });
  test("条件つきの操作", () => {
    expect(probeFindings(report({ inputs: [space({ during: SAME, after: SAME, always: false })] }))).toEqual([]);
  });
  test("宣言の無いキー", () => {
    expect(probeFindings(report({ inputs: [space({ during: SAME, after: SAME, declared: false })] }))).toEqual([]);
  });
  test("再現性なし", () => {
    expect(brief(report({ deterministic: false, inputs: [space({ during: SAME, after: SAME })] }))).toEqual([["warning", "P-determinism"]]);
  });
  test("まとめて", () => {
    const r = report({ dtZero: CHANGED, errors: ["frame: boom"], resize: { narrowSingleColor: true, errors: [] }, longRun: { ms: 20000, singleColor: true, errors: [] } });
    expect(brief(r)).toEqual([["blocking", "P-errors"], ["warning", "P-dt0"], ["blocking", "P-resize"], ["info", "P-long"]]);
    const c = probeChecks(r);
    expect(c.find((x) => x.id === "probe:long-run")!.pass).toBe(true);
    expect(c.find((x) => x.id === "probe:dt0-stable")!.pass).toBe(false);
    expect(probeFindings(r)[0].message).toBe("入力なしで 1600ms 動かす間に実行時エラー：frame: boom");
  });
  test("起動しない", () => {
    const r = report({ booted: false });
    expect(probeFindings(r)).toEqual([]);
    expect(probeChecks(r)).toEqual([]);
    expect(probeEvidenceIds(r)).toEqual([]);
    expect(probeText(r)).toBe("（作品が起動しなかったため、性質の観測は無い）");
  });
  test("文と証拠 id", () => {
    const click: InputEffect = { id: "P-pointer-1", kind: "pointer", input: "pointer", declared: false, action: null, always: false, point: { x: 70, y: 290 }, during: SAME, after: SAME, errors: [] };
    const r = report({ inputs: [space(), click] });
    const text = probeText(r);
    const heads = text.split("\n").map((l) => l.split(":")[0]);
    expect(heads).toEqual(["P-scene", "P-motion", "P-dt0", "P-determinism", "P-input-Space", "P-pointer-1", "P-resize", "P-long"]);
    expect(heads).toEqual(probeEvidenceIds(r));
    expect(text).toContain("キー Space（宣言：ジャンプ、いつでも効く）");
    expect(text).toContain("P-pointer-1: 描画のある点 (70,290) を 1000ms の時点でクリックした。入力なしの走行との差：直後 差なし、400ms 後 差なし");
    expect(text).toContain("押している間 400 画素（範囲 左上(60,200) 幅20 高さ100）");
    expect(text).not.toContain("格子");
  });
});
