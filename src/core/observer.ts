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

export const OBSERVER_SUITE = "host-smoke/1";

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
      const s0 = await grab();
      await page.evaluate(() => (window as any).harness.advance(1000));
      const s1 = await grab();
      // 題材によらない一定の入力列：キー操作と、6×4 の格子点のクリック
      await frame.click({ position: { x: 240, y: 180 } });
      for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "Space"]) await page.keyboard.press(k);
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 6; gx++) await frame.click({ position: { x: 40 + gx * 80, y: 45 + gy * 90 } });
      await page.evaluate(() => (window as any).harness.advance(500));
      const s2 = await grab();
      const errs = await errors();
      const changed = diff(s0, s1) > 0 || diff(s1, s2) > 0;
      const varied = colors(s2) > 1;
      if (errs.length) observations.push({ kind: "runtime-error", message: errs.map((e) => e.message).join(" / ").slice(0, 1000) });
      if (!varied) observations.push({ kind: "blank", message: "画面が単色のまま" });
      if (!changed) observations.push({ kind: "static", message: "時間の経過・入力で描画が変わらない" });
      checks.push({ id: "no-runtime-error", level: "operated", pass: errs.length === 0, detail: errs[0]?.message });
      checks.push({ id: "not-blank", level: "operated", pass: varied });
      checks.push({ id: "responds", level: "operated", pass: changed });
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
