// 評価用の観測環境。共通プレビュー（ハーネス）で作品を動かし、画素だけで判定する。
// 評価担当が凍結する。生成側には渡さない。
import type { Browser, Page } from "@playwright/test";
import { PNG } from "pngjs";

export type RGB = [number, number, number];
export const hex = (h: string): RGB => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

export interface Shot {
  w: number;
  h: number;
  data: Buffer;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Blob {
  count: number;
  cx: number;
  cy: number;
  box: Box | null;
}

export function blob(s: Shot, color: RGB, tol = 30, r?: Box): Blob {
  const R = r ?? { x: 0, y: 0, w: s.w, h: s.h };
  let n = 0, sx = 0, sy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = Math.max(0, Math.floor(R.y)); y < Math.min(s.h, Math.ceil(R.y + R.h)); y++)
    for (let x = Math.max(0, Math.floor(R.x)); x < Math.min(s.w, Math.ceil(R.x + R.w)); x++) {
      const i = (y * s.w + x) * 4;
      if (Math.abs(s.data[i] - color[0]) <= tol && Math.abs(s.data[i + 1] - color[1]) <= tol && Math.abs(s.data[i + 2] - color[2]) <= tol) {
        n++; sx += x; sy += y;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
  return { count: n, cx: n ? sx / n : NaN, cy: n ? sy / n : NaN, box: n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}

/** 色の連結成分（4 近傍）。小さい順に並ばない。 */
export function components(s: Shot, color: RGB, tol = 30, r?: Box, minPixels = 4): Blob[] {
  const R = r ?? { x: 0, y: 0, w: s.w, h: s.h };
  const x0 = Math.max(0, Math.floor(R.x)), y0 = Math.max(0, Math.floor(R.y));
  const x1 = Math.min(s.w, Math.ceil(R.x + R.w)), y1 = Math.min(s.h, Math.ceil(R.y + R.h));
  const W = x1 - x0, H = y1 - y0;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = ((y + y0) * s.w + x + x0) * 4;
      if (Math.abs(s.data[i] - color[0]) <= tol && Math.abs(s.data[i + 1] - color[1]) <= tol && Math.abs(s.data[i + 2] - color[2]) <= tol) mask[y * W + x] = 1;
    }
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] !== 1) continue;
    let n = 0, sx = 0, sy = 0, bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    mask[p] = 2;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % W, y = (q - x) / W;
      n++; sx += x; sy += y;
      if (x < bx0) bx0 = x; if (y < by0) by0 = y; if (x > bx1) bx1 = x; if (y > by1) by1 = y;
      for (const nq of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, y > 0 ? q - W : -1, y < H - 1 ? q + W : -1])
        if (nq >= 0 && mask[nq] === 1) { mask[nq] = 2; stack.push(nq); }
    }
    if (n >= minPixels) out.push({ count: n, cx: sx / n + x0, cy: sy / n + y0, box: { x: bx0 + x0, y: by0 + y0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 } });
  }
  return out;
}

export const YELLOW = hex("#ffff00");
export const OVER = hex("#400000");

/** 左上の黄色 8×8 の得点表示の個数。 */
export function scoreSquares(s: Shot): number {
  return components(s, YELLOW, 40, { x: 0, y: 0, w: s.w, h: 16 }, 30).filter((b) => b.box!.w >= 6 && b.box!.w <= 10 && b.box!.h >= 6 && b.box!.h <= 10).length;
}
export function isGameOver(s: Shot): boolean {
  return blob(s, OVER, 12).count >= s.w * s.h * 0.6;
}

export interface CheckResult {
  id: string;
  kind: "change" | "retain" | "start";
  pass: boolean;
  detail?: string;
}

export class EvalEnv {
  page!: Page;
  t = 0; // 進めた時刻の合計（ms）
  errors: string[] = [];
  constructor(private browser: Browser, private hostOrigin: string) {}

  async open(o: { narrow?: boolean } = {}) {
    const ctx = await this.browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    this.page = await ctx.newPage();
    await this.page.goto(this.hostOrigin + "/harness.html");
    await this.page.waitForFunction(() => document.title === "ready");
    if (o.narrow) await this.page.evaluate(() => (window as any).harness.setNarrow(true));
  }
  get width() {
    return this.narrow ? 240 : 480;
  }
  narrow = false;

  /** libraries は作品が宣言した同梱ライブラリ（render-v1。省略・空なら従来と同じ）。 */
  async start(entry: string, data: unknown, seed: number, o: { narrow?: boolean; libraries?: string[] } = {}) {
    this.narrow = !!o.narrow;
    this.lastPointer = null;
    await this.open(o);
    const r = await this.page.evaluate((a) => (window as any).harness.start(a), { entry, data, seed, clock: "manual", title: "eval", ...(o.libraries?.length ? { libraries: o.libraries } : {}) });
    this.t = 0;
    return r;
  }
  async close() {
    await this.page?.context().close();
  }
  async collectErrors() {
    const ev = await this.page.evaluate(() => (window as any).harness.events.filter((e: any) => e.type === "error" || e.type === "violation").map((e: any) => e.message));
    this.errors = ev;
    return ev;
  }
  private async settle() {
    const pf = this.page.frames().find((f) => f.url().includes("/shell.html"));
    if (pf) await pf.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }
  async advance(ms: number) {
    await this.settle();
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, 10_000);
      const r = await this.page.evaluate((m) => (window as any).harness.advance(m), step);
      if (r.type !== "advanced") throw new Error("advance が応答しない: " + r.type);
      left -= step;
    }
    this.t += ms;
  }
  async shot(): Promise<Shot> {
    const buf = await this.page.locator("#frame").screenshot({ scale: "css" });
    const p = PNG.sync.read(buf);
    return { w: p.width, h: p.height, data: p.data };
  }
  async focus() {
    await this.page.evaluate(() => (window as any).harness.focus());
  }
  async down(code: string) {
    await this.focus();
    await this.page.keyboard.down(keyName(code));
  }
  async up(code: string) {
    await this.page.keyboard.up(keyName(code));
  }
  async press(code: string) {
    await this.focus();
    await this.page.keyboard.press(keyName(code));
  }
  async hold(code: string, ms: number) {
    await this.down(code);
    await this.advance(ms);
    await this.up(code);
    await this.advance(0);
  }
  private lastPointer: { x: number; y: number } | null = null;
  async pointer(x: number, y: number) {
    const b = (await this.page.locator("#frame").boundingBox())!;
    if (!this.lastPointer) await this.page.mouse.move(b.x + x + 2, b.y + y + 2);
    await this.page.mouse.move(b.x + x, b.y + y, { steps: 2 });
    this.lastPointer = { x, y };
  }
  async click(x: number, y: number) {
    await this.pointer(x, y);
    await this.page.mouse.down();
    await this.page.mouse.up();
  }
}

function keyName(code: string) {
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  return code;
}
