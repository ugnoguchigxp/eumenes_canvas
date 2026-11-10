// ハーネス（検証ホストの /harness.html）で作品を 1 つ動かす操作のまとめ。性質の観測（host-probe）と検証担当の台本の実行が使う。
// src/core/observer.ts（host-smoke/2）と eval/lib/env.ts（評価）が直接書いている操作と同じ組み合わせ。observer.ts はこれを使わない（host-smoke/2 の動作を変えないため）。
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { ArtworkBody } from "../contract/artwork";
import type { Shot } from "./pixels";

export type IssueToken = (body: ArtworkBody) => string;
export interface StartResult { type: string; message?: string } // "ready" | "error" | "violation" | "timeout"

/** 入力の名前（KeyboardEvent.code の形）を Playwright のキー名にする。KeyR → r、Digit1 → 1、ほかはそのまま。 */
export function playwrightKey(input: string): string {
  if (/^Key[A-Z]$/.test(input)) return input.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(input)) return input.slice(5);
  return input;
}

/** ハーネスの advance は 1 回の呼び出しを実時間 10 秒で打ち切るので、作品の時間を 2000ms ずつに分けて進める。 */
const ADVANCE_STEP_MS = 2000;

export class HarnessSession {
  /** 起動から進めた時刻（ms）。 */
  t = 0;
  private ctx: BrowserContext | null = null;
  private page: Page | null = null;
  /** この起動より前の通知を読まないための位置。 */
  private eventsFrom = 0;

  constructor(private browser: Browser, private hostOrigin: string, private issue: IssueToken) {}

  private p(): Page {
    if (!this.page) throw new Error("HarnessSession: open() を先に呼ぶ");
    return this.page;
  }

  async open(): Promise<void> {
    this.ctx = await this.browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    this.page = await this.ctx.newPage();
    await this.page.goto(this.hostOrigin + "/harness.html");
    await this.page.waitForFunction(() => document.title === "ready", null, { timeout: 10_000 });
  }

  async start(body: ArtworkBody, data: unknown, seed = 1): Promise<StartResult> {
    const page = this.p();
    this.eventsFrom = await page.evaluate(() => (window as any).harness.events.length as number);
    this.t = 0;
    const token = this.issue(body);
    return (await page.evaluate((a) => (window as any).harness.startToken(a), { token, data, seed, clock: "manual" })) as StartResult;
  }

  /** 入力やリサイズがシェルに届く前に時間を進めないよう、シェルの requestAnimationFrame を 2 回待つ。 */
  private async settle(): Promise<void> {
    const pf = this.p().frames().find((f) => f.url().includes("/shell.html"));
    if (pf) await pf.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }

  async advance(ms: number): Promise<void> {
    const page = this.p();
    await this.settle();
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, ADVANCE_STEP_MS);
      const r = (await page.evaluate((m) => (window as any).harness.advance(m), step)) as StartResult;
      if (r.type !== "advanced") throw new Error("advance が応答しない: " + r.type);
      left -= step;
    }
    this.t += ms;
  }

  async poke(count: number): Promise<void> {
    const page = this.p();
    await this.settle();
    const r = (await page.evaluate((c) => (window as any).harness.poke(c), count)) as StartResult;
    if (r.type !== "advanced") throw new Error("poke が応答しない: " + r.type);
  }

  async shot(): Promise<Shot> {
    const { PNG } = await import("pngjs");
    const buf = await this.p().locator("#frame").screenshot({ scale: "css" });
    return PNG.sync.read(buf);
  }

  async keyDown(input: string): Promise<void> {
    const page = this.p();
    await page.evaluate(() => (window as any).harness.focus());
    await page.keyboard.down(playwrightKey(input));
  }

  async keyUp(input: string): Promise<void> {
    await this.p().keyboard.up(playwrightKey(input));
  }

  async click(x: number, y: number): Promise<void> {
    await this.p().locator("#frame").click({ position: { x, y } });
  }

  async drag(from: [number, number], to: [number, number], ms: number): Promise<void> {
    const page = this.p();
    const b = await page.locator("#frame").boundingBox();
    if (!b) throw new Error("HarnessSession: #frame が表示されていない");
    await page.mouse.move(b.x + from[0], b.y + from[1]);
    await page.mouse.down();
    await this.advance(0);
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(b.x + from[0] + ((to[0] - from[0]) * i) / 4, b.y + from[1] + ((to[1] - from[1]) * i) / 4);
      await this.advance(Math.round(ms / 4));
    }
    await page.mouse.up();
    await this.advance(0);
  }

  async setNarrow(on: boolean): Promise<void> {
    await this.p().evaluate((v) => (window as any).harness.setNarrow(v), on);
  }

  async errors(): Promise<string[]> {
    return (await this.p().evaluate(
      (from) => (window as any).harness.events.slice(from).filter((e: any) => e.type === "error" || e.type === "violation").map((e: any) => String(e.message)),
      this.eventsFrom,
    )) as string[];
  }

  async close(): Promise<void> {
    try {
      await this.ctx?.close();
    } catch {}
    this.ctx = null;
    this.page = null;
  }
}
