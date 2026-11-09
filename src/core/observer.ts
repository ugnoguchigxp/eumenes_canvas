// ブラウザ観測の接続口。候補を実際に起動し、起動・操作を画素で確かめる。
import type { ArtworkBody } from "../contract/artwork";
import type { CheckResult, Observation } from "./types";

export interface ObservationResult {
  environment: string;
  checks: CheckResult[];
  observations: Observation[];
}

export interface ObserverPort {
  readonly suite: string;
  observe(body: ArtworkBody, data: unknown, signal: AbortSignal): Promise<ObservationResult>;
  close(): Promise<void>;
}

/** host-smoke/2（2026-11-10）：固定点のクリックに加えて、作品が描いた領域の代表点もクリックし、段階ごとに画面を比べる。 */
export const OBSERVER_SUITE = "host-smoke/2";
/** 描画領域のクリックの上限。 */
export const PAINTED_CLICKS = 16;

type IssueToken = (body: ArtworkBody) => string;

/** Playwright（Chromium）で検証ホストのハーネスを開いて観測する。 */
export class PlaywrightObserver implements ObserverPort {
  readonly suite = OBSERVER_SUITE;
  private browser: any = null;
  constructor(private hostOrigin: string, private issue: IssueToken) {}

  private async getBrowser() {
    if (!this.browser) {
      const { chromium } = await import("@playwright/test");
      this.browser = await chromium.launch({ args: ["--mute-audio"] });
    }
    return this.browser;
  }

  async observe(body: ArtworkBody, data: unknown, signal: AbortSignal): Promise<ObservationResult> {
    const { PNG } = await import("pngjs");
    const browser = await this.getBrowser();
    const environment = `chromium ${browser.version()}`;
    const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
    const checks: CheckResult[] = [];
    const observations: Observation[] = [];
    const abort = () => ctx.close().catch(() => {});
    signal.addEventListener("abort", abort, { once: true });
    try {
      const page = await ctx.newPage();
      await page.goto(this.hostOrigin + "/harness.html");
      await page.waitForFunction(() => document.title === "ready", null, { timeout: 10_000 });
      const token = this.issue(body);
      const r = await page.evaluate((a: any) => (window as any).harness.startToken(a), { token, data, seed: 1, clock: "manual" });
      const errors = async () => (await page.evaluate(() => (window as any).harness.events.filter((e: any) => e.type === "error" || e.type === "violation"))) as any[];
      if (r.type !== "ready") {
        const errs = await errors();
        const msg = errs.map((e) => e.message).join(" / ") || (r.type === "timeout" ? "10 秒以内に ready にならない" : r.type);
        checks.push({ id: "boot", level: "loaded", pass: false, detail: msg });
        observations.push({ kind: r.type === "timeout" ? "boot-timeout" : "runtime-error", message: msg });
        return { environment, checks, observations };
      }
      checks.push({ id: "boot", level: "loaded", pass: true });
      const frame = page.locator("#frame");
      const grab = async () => PNG.sync.read(await frame.screenshot({ scale: "css" }));
      // 段階ごとに画面を撮り、隣どうしを比べる。実行時エラーは最初に出た段階を残す。
      let firstErrorPhase: string | null = null;
      const noteErrors = async (phase: string) => {
        if (!firstErrorPhase && (await errors()).length) firstErrorPhase = phase;
      };
      const s0 = await grab();
      await page.evaluate(() => (window as any).harness.advance(1000));
      const s1 = await grab();
      await noteErrors("時間の経過（起動から 1000ms）");
      // 題材によらない一定の入力列：キー操作と、画面全体に散らした固定点のクリック（座標は観測の文に書かない）
      await frame.click({ position: { x: 240, y: 180 } });
      for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "Space"]) await page.keyboard.press(k);
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 6; gx++) await frame.click({ position: { x: 40 + gx * 80, y: 45 + gy * 90 } });
      await page.evaluate(() => (window as any).harness.advance(500));
      const s2 = await grab();
      await noteErrors("キー入力と画面全体のクリック（起動から 1500ms）");
      // 作品が描いた領域（背景色と違う画素のまとまり）の代表点をクリックする
      const targets = paintedTargets(s2, PAINTED_CLICKS);
      for (const p of targets) await frame.click({ position: p });
      await page.evaluate(() => (window as any).harness.advance(500));
      const s3 = await grab();
      await noteErrors("描画領域のクリック（起動から 2000ms）");
      const errs = await errors();
      const d = [diff(s0, s1), diff(s1, s2), diff(s2, s3)];
      const changed = d.some((x) => x > 0);
      const varied = colors(s2) > 1;
      const clicked = targets.length ? targets.map((p) => `(${p.x},${p.y})`).join(" ") : "なし（背景以外の描画が見つからない）";
      const staticMsg =
        `起動から 2000ms 観測したが描画が変わらない。段階ごとの差分画素：` +
        `時間の経過 1000ms（入力なし）で ${d[0]}、キー入力（← → ↑ Space）と画面全体に散らした ${GRID_CLICKS} 点のクリックのあと 500ms で ${d[1]}、` +
        `描画のある領域 ${targets.length} 点のクリックのあと 500ms で ${d[2]}。描画領域のクリック座標（CSS px、画面 ${s2.width}×${s2.height}）：${clicked}`;
      if (errs.length) observations.push({ kind: "runtime-error", message: `${firstErrorPhase ? `[${firstErrorPhase}の段階で発生] ` : ""}${errs.map((e) => e.message).join(" / ")}`.slice(0, 1000) });
      if (!varied) observations.push({ kind: "blank", message: `キー入力と画面全体のクリックのあと（起動から 1500ms）の画面が単色 ${hexAt(s2, 0)} のまま` });
      if (!changed) observations.push({ kind: "static", message: staticMsg });
      checks.push({ id: "no-runtime-error", level: "operated", pass: errs.length === 0, detail: errs[0]?.message });
      checks.push({ id: "not-blank", level: "operated", pass: varied });
      checks.push({ id: "responds", level: "operated", pass: changed, detail: changed ? undefined : `差分画素 ${d.join("/")}、描画領域のクリック ${targets.length} 点` });
      await page.evaluate(() => (window as any).harness.stop());
      return { environment, checks, observations };
    } finally {
      signal.removeEventListener("abort", abort);
      await ctx.close().catch(() => {});
    }
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = null;
  }
}

function diff(a: { data: Buffer; width: number; height: number }, b: { data: Buffer }) {
  let d = 0;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) d++;
  return d;
}
function colors(a: { data: Buffer }) {
  const set = new Set<number>();
  for (let i = 0; i < a.data.length && set.size < 3; i += 16) set.add((a.data[i] << 16) | (a.data[i + 1] << 8) | a.data[i + 2]);
  return set.size;
}

const GRID_CLICKS = 24;

function hexAt(a: { data: Buffer }, i: number) {
  return "#" + [a.data[i * 4], a.data[i * 4 + 1], a.data[i * 4 + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * 作品が描いた領域の代表点。最も多い色を背景とし、背景と違う画素が 3 個以上ある 8px のセルを 8 近傍でまとめる。
 * 画面の 1/4 を超えるまとまり（背景の一部とみなす）は除き、大きい順に最大 max 個。
 * 代表点は、まとまりの重心に最も近いセルの中で、セル中心に最も近い背景でない画素。
 */
export function paintedTargets(png: { width: number; height: number; data: Buffer | Uint8Array }, max: number): { x: number; y: number }[] {
  const { width: W, height: H, data } = png;
  const counts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let bg = 0, best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; bg = k; }
  const br = bg >> 16, bgG = (bg >> 8) & 255, bb = bg & 255;
  const fg = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return Math.abs(data[i] - br) > 24 || Math.abs(data[i + 1] - bgG) > 24 || Math.abs(data[i + 2] - bb) > 24;
  };
  const C = 8, CW = Math.ceil(W / C), CH = Math.ceil(H / C);
  const cell = new Uint8Array(CW * CH);
  for (let cy = 0; cy < CH; cy++)
    for (let cx = 0; cx < CW; cx++) {
      let n = 0;
      for (let y = cy * C; y < Math.min(H, cy * C + C) && n < 3; y++) for (let x = cx * C; x < Math.min(W, cx * C + C) && n < 3; x++) if (fg(x, y)) n++;
      if (n >= 3) cell[cy * CW + cx] = 1;
    }
  const comps: { cells: number[]; sx: number; sy: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let p = 0; p < cell.length; p++) {
    if (cell[p] !== 1) continue;
    const c = { cells: [] as number[], sx: 0, sy: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const stack = [p];
    cell[p] = 2;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % CW, qy = (q - qx) / CW;
      c.cells.push(q); c.sx += qx; c.sy += qy;
      c.x0 = Math.min(c.x0, qx); c.y0 = Math.min(c.y0, qy); c.x1 = Math.max(c.x1, qx); c.y1 = Math.max(c.y1, qy);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = qx + dx, ny = qy + dy;
          if (nx < 0 || ny < 0 || nx >= CW || ny >= CH) continue;
          const nq = ny * CW + nx;
          if (cell[nq] === 1) { cell[nq] = 2; stack.push(nq); }
        }
    }
    if ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) * C * C <= (W * H) / 4) comps.push(c);
  }
  comps.sort((a, b) => b.cells.length - a.cells.length || a.cells[0] - b.cells[0]);
  const out: { x: number; y: number }[] = [];
  for (const c of comps.slice(0, max)) {
    const mx = c.sx / c.cells.length, my = c.sy / c.cells.length;
    let q = c.cells[0], dq = Infinity;
    for (const r of c.cells) {
      const rx = r % CW, ry = (r - rx) / CW, dd = (rx - mx) ** 2 + (ry - my) ** 2;
      if (dd < dq) { dq = dd; q = r; }
    }
    const qx = q % CW, qy = (q - qx) / CW, ccx = qx * C + C / 2, ccy = qy * C + C / 2;
    let pt = { x: Math.min(W - 1, Math.floor(ccx)), y: Math.min(H - 1, Math.floor(ccy)) }, dp = Infinity;
    for (let y = qy * C; y < Math.min(H, qy * C + C); y++)
      for (let x = qx * C; x < Math.min(W, qx * C + C); x++)
        if (fg(x, y)) {
          const dd = (x - ccx) ** 2 + (y - ccy) ** 2;
          if (dd < dp) { dp = dd; pt = { x, y }; }
        }
    out.push(pt);
  }
  return out;
}
