// 描画方式の拡張のデモ（examples/render/）を共通プレビューで動かし、起動時間・advance の所要時間・画面・観測（host-smoke）を記録する。
//   bun scripts/render-demos.ts [--only ID] [--out eval/out/render-demos] [--port 4840] [--no-observe]
// 画面は --out に PNG で残す（eval/out は git の対象外）。結果の JSON は <out>/summary.json。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { PNG } from "pngjs";
import { PlaywrightObserver } from "../src/core/observer";
import { startApp } from "../src/server/app";

type Step = ["wait", number] | ["key", string, number] | ["click", [number, number]] | ["drag", [number, number], [number, number]];
interface Demo { id: string; title: string; entry: string; libraries?: string[]; script: Step[] }

const DIR = resolve(import.meta.dir, "../examples/render");
const { values } = parseArgs({ options: { only: { type: "string" }, out: { type: "string" }, port: { type: "string" }, "no-observe": { type: "boolean" } } });
const out = resolve(values.out ?? "eval/out/render-demos");
mkdirSync(out, { recursive: true });
const port = Number(values.port ?? 4840);
const demos = (JSON.parse(readFileSync(join(DIR, "demos.json"), "utf8")) as { demos: Demo[] }).demos.filter((d) => !values.only || d.id === values.only);
const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
const browser = await chromium.launch({ args: ["--mute-audio"] });

function stats(buf: Buffer) {
  const p = PNG.sync.read(buf);
  const cols = new Map<number, number>();
  for (let i = 0; i < p.data.length; i += 4) {
    const k = ((p.data[i] >> 3) << 10) | ((p.data[i + 1] >> 3) << 5) | (p.data[i + 2] >> 3);
    cols.set(k, (cols.get(k) ?? 0) + 1);
  }
  const top = Math.max(...cols.values());
  return { colors15: cols.size, dominant: +(top / (p.width * p.height)).toFixed(3) };
}

const rows: unknown[] = [];
try {
  for (const d of demos) {
    const entry = readFileSync(join(DIR, d.entry), "utf8");
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const consoleMsgs: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(m.text().slice(0, 200)); });
    await page.goto(app.hostOrigin + "/harness.html");
    await page.waitForFunction(() => document.title === "ready");
    const t0 = performance.now();
    const r = await page.evaluate((a) => (window as any).harness.start(a), { entry, title: d.title, libraries: d.libraries, clock: "manual" });
    const bootMs = Math.round(performance.now() - t0);
    const frame = page.locator("#frame");
    const box = (await frame.boundingBox())!;
    const shots: Record<string, unknown> = {};
    const advanceTimes: number[] = [];
    const adv = async (ms: number) => {
      for (let left = ms; left > 0; left -= 1000) {
        const a = performance.now();
        await page.evaluate((m) => (window as any).harness.advance(m), Math.min(1000, left));
        advanceTimes.push(Math.round(performance.now() - a));
      }
    };
    const snap = async (name: string) => {
      const buf = await frame.screenshot({ scale: "css" });
      writeFileSync(join(out, `${d.id}-${name}.png`), buf);
      shots[name] = stats(buf);
    };
    if (r.type === "ready") {
      await snap("0-boot");
      let i = 1;
      for (const s of d.script) {
        if (s[0] === "wait") await adv(s[1]);
        else if (s[0] === "key") {
          await page.evaluate(() => (window as any).harness.focus());
          await page.keyboard.down(s[1]);
          await adv(s[2]);
          await page.keyboard.up(s[1]);
          await adv(16);
        } else if (s[0] === "click") {
          await page.mouse.click(box.x + s[1][0], box.y + s[1][1]);
          await adv(100);
        } else if (s[0] === "drag") {
          await page.mouse.move(box.x + s[1][0], box.y + s[1][1]);
          await page.mouse.down();
          await page.mouse.move(box.x + s[2][0], box.y + s[2][1], { steps: 8 });
          await page.mouse.up();
          await adv(100);
        }
        await snap(`${i++}-${s[0]}`);
      }
    }
    const events = await page.evaluate(() => (window as any).harness.events.filter((e: any) => e.type !== "frame").map((e: any) => ({ type: e.type, message: e.message, value: e.value })));
    await ctx.close();
    let observe: unknown = null;
    if (!values["no-observe"]) {
      const obs = new PlaywrightObserver(app.hostOrigin, (b) => app.tokens.issue(b));
      const o0 = performance.now();
      const res = await obs.observe({ title: d.title, entry, ...(d.libraries ? { libraries: d.libraries } : {}) }, null, new AbortController().signal);
      observe = { ms: Math.round(performance.now() - o0), checks: res.checks.map((c) => `${c.pass ? "○" : "×"}${c.id}`).join(" "), observations: res.observations.map((x) => `${x.kind}: ${x.message.slice(0, 200)}`) };
      await obs.close();
    }
    const errors = events.filter((e: any) => e.type === "error" || e.type === "violation").map((e: any) => e.message);
    const statuses = events.filter((e: any) => e.type === "status").map((e: any) => e.value);
    const row = { id: d.id, boot: r.type, bootMs, entryBytes: Buffer.byteLength(entry), advance1000Ms: advanceTimes, shots, errors, lastStatus: statuses.at(-1) ?? null, statusTrail: process.env.TRAIL ? statuses : undefined, console: consoleMsgs.slice(0, 5), observe };
    rows.push(row);
    console.log(JSON.stringify(row, null, 1));
  }
} finally {
  await browser.close();
  app.stop();
}
writeFileSync(join(out, "summary.json"), JSON.stringify({ at: new Date().toISOString(), environment: `chromium ${browser.version()}`, rows }, null, 2));
process.exit(0);
