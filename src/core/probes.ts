// 性質の観測 host-probe/1（推論を使わない）。題材によらない性質を、同じ seed と手動の時計で調べる。
// 入力ごとの効果・dt = 0 の不変性・再現性・リサイズ・長時間。結果は助言で、保存の必須にしない（docs/agent-plan/README.md 規則 1）。
// クリックの点は作品が描いた領域（paintedTargets）だけから取る。observer.ts の固定点は使わない。
import type { ArtworkBody } from "../contract/artwork";
import { HarnessSession, type IssueToken } from "./harness-session";
import { paintedTargets } from "./observer";
import { describeScene, diffShots, isSingleColor, sceneText, type DiffResult, type Shot } from "./pixels";
import type { ReviewFinding } from "./review";
import type { MakerSpec } from "./spec";
import type { CheckResult } from "./types";

export const PROBE_SUITE = "host-probe/1";
export const PROBE = {
  seed: 1,
  preMs: 1000, // 入力の前に進める時間
  holdMs: 200, // キーを押している時間
  postMs: 400, // 離したあとに進める時間
  pokeCount: 30, // 時間を進めない描き直しの回数
  maxKeys: 6, // 調べるキーの上限
  maxPointers: 4, // 調べるクリックの上限
  longMs: 20_000, // 長時間の観測で進める時間
  heavyWallMs: 400, // 1000ms 進めるのに実時間がこれを超えたら、長時間の観測を省く
  budgetMs: 20_000, // 観測全体の実時間の上限。超えたら残りを省く
  scriptBudgetMs: 30_000, // 07 の台本全体の実時間の上限
} as const;
const DEFAULT_KEYS = ["ArrowLeft", "ArrowRight", "ArrowUp", "Space"]; // 宣言が無い作品で調べるキー

export interface InputEffect {
  id: string; // 証拠 id。キーは "P-input-<入力名>"、クリックは "P-pointer-<1 始まりの番号>"
  kind: "key" | "pointer";
  input: string; // キーは入力名（"Space"）。クリックは "pointer"
  declared: boolean; // 制作担当が宣言した操作か
  action: string | null; // 宣言の説明
  always: boolean; // 宣言の「いつでも効く」
  point: { x: number; y: number } | null; // クリックした点
  during: DiffResult; // 入力なしの走行との差：押している間（クリックは直後）
  after: DiffResult; // 同：離して postMs 後
  errors: string[];
}

export interface ProbeReport {
  suite: string;
  environment: string; // "chromium <版>"
  ms: number; // 観測にかかった実時間
  booted: boolean;
  scene: string; // 起動から preMs の画面の要約（sceneText）
  sceneEnd: string; // preMs + holdMs + postMs の画面の要約
  motion: DiffResult | null; // 入力なしで preMs から最後までに変わった画素
  deterministic: boolean | null;
  dtZero: DiffResult | null;
  inputs: InputEffect[];
  resize: { narrowSingleColor: boolean; errors: string[] } | null;
  longRun: { ms: number; singleColor: boolean; errors: string[] } | null;
  errors: string[]; // 入力なしの走行で出た実行時エラー（5 件まで）
  skipped: string[]; // 省いた観測の名前と理由
}

export interface ProbePort {
  readonly suite: string;
  probe(body: ArtworkBody, data: unknown, spec: MakerSpec | null, signal: AbortSignal): Promise<ProbeReport>;
  close(): Promise<void>;
}

// ---- 規則と文（純粋な関数） ----

const END_MS = PROBE.preMs + PROBE.holdMs + PROBE.postMs;
const cut = (s: string, n: number) => String(s).slice(0, n);
const rangeText = (d: DiffResult) => (d.box ? `（範囲 左上(${d.box.x},${d.box.y}) 幅${d.box.w} 高さ${d.box.h}）` : "");
const diffText = (d: DiffResult) => (d.pixels === 0 ? "差なし" : `${d.pixels} 画素${rangeText(d)}`);
const inputName = (i: InputEffect) => (i.kind === "key" ? `キー ${i.input}` : `クリック (${i.point?.x ?? "?"},${i.point?.y ?? "?"})`);

/** 観測の結果から、制作担当・検証担当に渡す指摘を作る。起動しない作品は必須の検査で落ちるので空。 */
export function probeFindings(r: ProbeReport): ReviewFinding[] {
  if (!r.booted) return [];
  const out: ReviewFinding[] = [];
  const add = (severity: ReviewFinding["severity"], id: string, message: string) => out.push({ source: "probe", severity, id, message });
  if (r.errors.length) add("blocking", "P-errors", `入力なしで ${END_MS}ms 動かす間に実行時エラー：${cut(r.errors[0], 300)}`);
  if (r.dtZero && r.dtZero.pixels > 0)
    add(
      "warning",
      "P-dt0",
      `時間を進めずに描き直しを ${PROBE.pokeCount} 回行うと、画面が ${r.dtZero.pixels} 画素変わった${rangeText(r.dtZero)}。dt = 0 の呼び出しで状態（物理・移動・タイマー・フレーム数）を進めている可能性がある。入力のたびに dt = 0 で呼ばれるので、入力で速さが変わる・入力直後の動きが消える原因になる`,
    );
  if (r.deterministic === false)
    add("warning", "P-determinism", "同じ seed・同じ時間で 2 回動かすと画面が違った。Math.random・Date.now・performance.now を進行に使っている可能性がある（乱数は api.random()、時間は frame の t・dt を使う）");
  for (const i of r.inputs) {
    if (i.errors.length) add("blocking", i.id, `${inputName(i)} の入力のあとに実行時エラー：${cut(i.errors[0], 300)}`);
    else if (i.kind === "key" && i.declared && i.always && r.deterministic === true && i.during.pixels === 0 && i.after.pixels === 0)
      add(
        "blocking",
        i.id,
        `宣言した操作「${i.input}：${i.action ?? ""}」（いつでも効く）を、起動から ${PROBE.preMs}ms の時点で ${PROBE.holdMs}ms 押して離したが、押している間も、離して ${PROBE.postMs}ms 後も、押さなかった場合と画面が 1 画素も違わない。入力が効いていない`,
      );
  }
  if (r.resize?.errors.length) add("blocking", "P-resize", `表示の幅を 480 から 240 に変えて戻す間に実行時エラー：${cut(r.resize.errors[0], 300)}`);
  else if (r.resize?.narrowSingleColor) add("blocking", "P-resize", "表示の幅を 240 に狭めると画面が単色になった。レイアウトを api.width・api.height から計算していない可能性がある");
  if (r.longRun?.errors.length) add("blocking", "P-long", `入力なしで ${PROBE.longMs}ms 動かす間に実行時エラー：${cut(r.longRun.errors[0], 300)}`);
  else if (r.longRun?.singleColor) add("info", "P-long", `入力なしで ${PROBE.longMs}ms 動かすと画面が単色になった（終了画面が単色の可能性）`);
  return out;
}

/** 検証記録に残す検査（すべて advisory）。info 以外の指摘が付いた id を「問題あり」とする。 */
export function probeChecks(r: ProbeReport): CheckResult[] {
  if (!r.booted) return [];
  const bad = new Map<string, string>();
  for (const f of probeFindings(r)) if (f.severity !== "info" && !bad.has(f.id)) bad.set(f.id, f.message);
  const check = (id: string, findingId: string): CheckResult => {
    const m = bad.get(findingId);
    return m === undefined ? { id, level: "advisory", pass: true } : { id, level: "advisory", pass: false, detail: cut(m, 300) };
  };
  const out: CheckResult[] = [check("probe:no-error", "P-errors")];
  if (r.dtZero) out.push(r.dtZero.pixels === 0 ? { id: "probe:dt0-stable", level: "advisory", pass: true } : { id: "probe:dt0-stable", level: "advisory", pass: false, detail: `${r.dtZero.pixels} 画素変わった` });
  if (r.deterministic !== null) out.push({ id: "probe:deterministic", level: "advisory", pass: r.deterministic === true });
  for (const i of r.inputs) if (i.declared) out.push(check(`probe:input:${i.input}`, i.id));
  if (r.resize) out.push(check("probe:resize", "P-resize"));
  if (r.longRun) out.push(check("probe:long-run", "P-long"));
  return out;
}

/** 検証担当が引用できる証拠 id の一覧（probeText の行の順と同じ）。 */
export function probeEvidenceIds(r: ProbeReport): string[] {
  if (!r.booted) return [];
  const ids = ["P-scene", "P-motion"];
  if (r.errors.length) ids.push("P-errors");
  if (r.dtZero) ids.push("P-dt0");
  if (r.deterministic !== null) ids.push("P-determinism");
  for (const i of r.inputs) ids.push(i.id);
  if (r.resize) ids.push("P-resize");
  if (r.longRun) ids.push("P-long");
  return ids;
}

/** 制作担当・検証担当に渡す観測の文。各行の先頭が証拠 id。 */
export function probeText(r: ProbeReport): string {
  if (!r.booted) return "（作品が起動しなかったため、性質の観測は無い）";
  const lines: string[] = [];
  lines.push(`P-scene: 起動から ${PROBE.preMs}ms（入力なし）の画面。${r.scene}`);
  lines.push(`P-motion: 入力なしで ${PROBE.preMs}ms から ${END_MS}ms までに変わった画素は ${r.motion ? diffText(r.motion) : "未測定"}。${END_MS}ms の画面。${r.sceneEnd}`);
  if (r.errors.length) lines.push(`P-errors: 入力なしの走行で実行時エラー：${cut(r.errors.slice(0, 3).join(" / "), 600)}`);
  if (r.dtZero) lines.push(`P-dt0: 時間を進めない描き直し ${PROBE.pokeCount} 回で変わった画素は ${diffText(r.dtZero)}`);
  if (r.deterministic !== null) lines.push(`P-determinism: 同じ seed で 2 回動かした画面は${r.deterministic ? "一致した" : "一致しなかった"}`);
  for (const i of r.inputs) {
    let line: string;
    if (i.kind === "key") {
      const decl = i.declared ? `（宣言：${i.action ?? ""}、${i.always ? "いつでも効く" : "条件つき"}）` : "（宣言なし）";
      line = `${i.id}: キー ${i.input}${decl}を ${PROBE.preMs}ms の時点で ${PROBE.holdMs}ms 押して離した。入力なしの走行との差：押している間 ${diffText(i.during)}、${PROBE.postMs}ms 後 ${diffText(i.after)}`;
    } else {
      line = `${i.id}: 描画のある点 (${i.point?.x ?? "?"},${i.point?.y ?? "?"}) を ${PROBE.preMs}ms の時点でクリックした。入力なしの走行との差：直後 ${diffText(i.during)}、${PROBE.postMs}ms 後 ${diffText(i.after)}`;
    }
    if (i.errors.length) line += `。実行時エラー：${cut(i.errors[0], 300)}`;
    lines.push(line);
  }
  if (r.resize)
    lines.push(`P-resize: 幅を 240 に狭めて戻した。${r.resize.errors.length ? `実行時エラー：${cut(r.resize.errors[0], 300)}` : r.resize.narrowSingleColor ? "狭い間、画面が単色になった" : "エラーなし、狭い間も描画あり"}`);
  if (r.longRun)
    lines.push(`P-long: 入力なしで ${PROBE.longMs}ms 動かした。${r.longRun.errors.length ? `実行時エラー：${cut(r.longRun.errors[0], 300)}` : r.longRun.singleColor ? "最後の画面は単色" : "エラーなし、最後の画面に描画あり"}`);
  if (r.skipped.length) lines.push(`（省いた観測：${r.skipped.join("、")}）`);
  return lines.join("\n");
}

// ---- 実行（Playwright の Chromium） ----

/** Playwright（Chromium）で検証ホストのハーネスを開き、性質を調べる。観測 1 回につき HarnessSession を 1 つ使う。 */
export class PlaywrightProber implements ProbePort {
  readonly suite = PROBE_SUITE;
  private browser: any = null;
  constructor(private hostOrigin: string, private issue: IssueToken, private launchArgs: string[] = []) {}

  protected async getBrowser() {
    if (!this.browser) {
      const { chromium } = await import("@playwright/test");
      this.browser = await chromium.launch({ args: ["--mute-audio", ...this.launchArgs] });
    }
    return this.browser;
  }

  async probe(body: ArtworkBody, data: unknown, spec: MakerSpec | null, signal: AbortSignal): Promise<ProbeReport> {
    const t0 = performance.now();
    const browser = await this.getBrowser();
    const report: ProbeReport = {
      suite: PROBE_SUITE,
      environment: `chromium ${browser.version()}`,
      ms: 0,
      booted: false,
      scene: "",
      sceneEnd: "",
      motion: null,
      deterministic: null,
      dtZero: null,
      inputs: [],
      resize: null,
      longRun: null,
      errors: [],
      skipped: [],
    };
    const s = new HarnessSession(browser, this.hostOrigin, this.issue);
    const abort = () => void s.close();
    signal.addEventListener("abort", abort, { once: true });
    try {
      await s.open();
      const boot = async () => (await s.start(body, data, PROBE.seed)).type === "ready" && (await s.advance(PROBE.preMs), true);
      /** advance(holdMs) → 撮る → （間の操作）→ advance(postMs) → 撮る */
      const twoShots = async (between?: () => Promise<void>): Promise<[Shot, Shot]> => {
        await s.advance(PROBE.holdMs);
        const a = await s.shot();
        if (between) await between();
        await s.advance(PROBE.postMs);
        return [a, await s.shot()];
      };
      const overBudget = () => performance.now() - t0 > PROBE.budgetMs;

      // 1 基準（入力なし）
      const w0 = performance.now();
      if (!(await boot())) return report;
      const bootWall = performance.now() - w0;
      report.booted = true;
      const bPre = await s.shot();
      const [bHold, bEnd] = await twoShots();
      await s.poke(PROBE.pokeCount);
      const bPoke = await s.shot();
      report.errors = (await s.errors()).slice(0, 5);
      report.scene = sceneText(describeScene(bPre));
      report.sceneEnd = sceneText(describeScene(bEnd));
      report.motion = diffShots(bPre, bEnd);
      report.dtZero = diffShots(bEnd, bPoke);

      // 2 再現性
      if (await boot()) {
        const r0 = await s.shot();
        const [r1, r2] = await twoShots();
        report.deterministic = diffShots(bPre, r0).pixels === 0 && diffShots(bHold, r1).pixels === 0 && diffShots(bEnd, r2).pixels === 0;
      }

      // 3・4 入力ごと（再現性が無いと、入力の効果と走行ごとの揺れを区別できない）
      if (report.deterministic !== true) report.skipped.push("入力ごとの比較（再現性が無い）");
      else {
        const keys = spec
          ? spec.controls.filter((c) => c.kind === "key").slice(0, PROBE.maxKeys).map((c) => ({ input: c.input, declared: true, action: c.action as string | null, always: c.always }))
          : DEFAULT_KEYS.map((k) => ({ input: k, declared: false, action: null as string | null, always: false }));
        for (const k of keys) {
          if (overBudget()) { report.skipped.push(`キー ${k.input}（時間の上限）`); continue; }
          if (!(await boot())) continue;
          await s.keyDown(k.input);
          const [kHold, kEnd] = await twoShots(() => s.keyUp(k.input));
          report.inputs.push({ id: `P-input-${k.input}`, kind: "key", input: k.input, declared: k.declared, action: k.action, always: k.always, point: null, during: diffShots(bHold, kHold), after: diffShots(bEnd, kEnd), errors: (await s.errors()).slice(0, 3) });
        }
        const points = paintedTargets(bPre, PROBE.maxPointers);
        for (let n = 0; n < points.length; n++) {
          const p = points[n];
          if (overBudget()) { report.skipped.push(`クリック ${n + 1}（時間の上限）`); continue; }
          if (!(await boot())) continue;
          await s.click(p.x, p.y);
          const [cHold, cEnd] = await twoShots();
          report.inputs.push({ id: `P-pointer-${n + 1}`, kind: "pointer", input: "pointer", declared: false, action: null, always: false, point: { x: p.x, y: p.y }, during: diffShots(bHold, cHold), after: diffShots(bEnd, cEnd), errors: (await s.errors()).slice(0, 3) });
        }
      }

      // 5 リサイズ
      if (overBudget()) report.skipped.push("リサイズ（時間の上限）");
      else if (await boot()) {
        await s.setNarrow(true);
        await s.advance(100);
        const narrow = await s.shot();
        await s.setNarrow(false);
        await s.advance(100);
        report.resize = { narrowSingleColor: isSingleColor(narrow) && !isSingleColor(bPre), errors: (await s.errors()).slice(0, 3) };
      }

      // 6 長時間
      if (bootWall > PROBE.heavyWallMs) report.skipped.push("長時間（描画が重い）");
      else if (overBudget()) report.skipped.push("長時間（時間の上限）");
      else if (await boot()) {
        await s.advance(PROBE.longMs - PROBE.preMs);
        const last = await s.shot();
        report.longRun = { ms: PROBE.longMs, singleColor: isSingleColor(last), errors: (await s.errors()).slice(0, 3) };
      }
      return report;
    } finally {
      report.ms = Math.round(performance.now() - t0);
      signal.removeEventListener("abort", abort);
      await s.close();
    }
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = null;
  }
}
