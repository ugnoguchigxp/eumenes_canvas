import { expect, type Page } from "@playwright/test";

export const CANARY = "http://127.0.0.1:4312";

export async function openHarness(page: Page) {
  await page.goto("/harness.html");
  await expect(page).toHaveTitle("ready");
}

export async function start(page: Page, entry: string, o: { data?: unknown; seed?: number; clock?: "raf" | "manual"; title?: string; libraries?: string[]; direct?: boolean } = {}) {
  return page.evaluate((a) => (window as any).harness.start(a), { entry, data: o.data ?? null, seed: o.seed ?? 1, clock: o.clock ?? "manual", title: o.title ?? "probe", ...(o.libraries ? { libraries: o.libraries } : {}), ...(o.direct ? { direct: true } : {}) });
}

export async function advance(page: Page, ms: number) {
  return page.evaluate((m) => (window as any).harness.advance(m), ms);
}

export async function events(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).harness.events.map((e: any) => ({ ...e })));
}

export async function statuses(page: Page): Promise<any[]> {
  return (await events(page)).filter((e) => e.type === "status").map((e) => e.value);
}

export async function waitStatus(page: Page, pred: (v: any) => boolean, timeout = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = (await statuses(page)).find(pred);
    if (s) return s;
    await page.waitForTimeout(50);
  }
  return null;
}

export async function canaryHits(): Promise<any[]> {
  return (await fetch(CANARY + "/__hits")).json();
}
export async function canaryReset() {
  await fetch(CANARY + "/__reset");
}
