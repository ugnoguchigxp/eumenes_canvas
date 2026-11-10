// render-v1 の判定の自己確認（評価担当）。生成ランの前に通す。
//   bun eval/render/self-test.ts [--task ID] [--out docs/eval/render-v1-self-test.json] [--port 4782]
// 対照：黒一色（全観点が不合格）、参照の作品（全観点が合格）、変異（名前を挙げた観点だけが不合格）。
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { startApp } from "../../src/server/app";
import { RENDER_CHECKS } from "../checks/render";
import type { CheckResult } from "../lib/env";
import { EvalEnv } from "../lib/env";
import { goldEntry, MUTANTS, mutate, RENDER_TASKS } from "./suite";

const BLANK = `canvasApp.start((api) => ({ frame() { api.ctx.fillStyle = "#000000"; api.ctx.fillRect(0, 0, api.width, api.height); } }));`;
type Expect = { kind: "all-pass" } | { kind: "all-fail" } | { kind: "fails"; ids: string[] };
interface Control { task: string; name: string; entry: string; libraries?: string[]; expect: Expect }

export function controls(): Control[] {
  const out: Control[] = [];
  for (const t of RENDER_TASKS) {
    out.push({ task: t.id, name: "黒一色", entry: BLANK, expect: { kind: "all-fail" } });
    out.push({ task: t.id, name: `参照 gold/render/${t.id}.js`, entry: goldEntry(t.id), libraries: t.libraries, expect: { kind: "all-pass" } });
    for (const m of MUTANTS.filter((x) => x.task === t.id)) out.push({ task: t.id, name: `変異「${m.name}」`, entry: mutate(m), libraries: t.libraries, expect: { kind: "fails", ids: m.fails } });
  }
  return out;
}

export function judge(e: Expect, r: CheckResult[]) {
  if (!r.length) return false;
  if (e.kind === "all-pass") return r.every((x) => x.pass);
  if (e.kind === "all-fail") return r.every((x) => !x.pass);
  return r.every((x) => x.pass === !e.ids.includes(x.id));
}
const label = (e: Expect) => (e.kind === "fails" ? `${e.ids.join("・")} だけ不合格` : e.kind);

async function main() {
  const { values } = parseArgs({ options: { task: { type: "string" }, out: { type: "string" }, port: { type: "string" } } });
  const port = Number(values.port ?? 4782);
  const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
  const browser = await chromium.launch({ args: ["--mute-audio"] });
  const env = new EvalEnv(browser, app.hostOrigin);
  const rows: unknown[] = [];
  let bad = 0;
  const t0 = Date.now();
  try {
    for (const c of controls()) {
      if (values.task && c.task !== values.task) continue;
      const t = RENDER_TASKS.find((x) => x.id === c.task)!;
      const s = Date.now();
      const r = await RENDER_CHECKS[t.id](env, c.entry, c.libraries, t.seed);
      const ok = judge(c.expect, r);
      if (!ok) bad++;
      rows.push({ task: c.task, name: c.name, expect: label(c.expect), ok, ms: Date.now() - s, checks: r });
      console.log(`${ok ? "OK  " : "NG  "} ${c.task} ${c.name}（期待 ${label(c.expect)}、${((Date.now() - s) / 1000).toFixed(1)} 秒）`);
      for (const x of r) console.log(`      ${x.pass ? "○" : "×"} [${x.kind}] ${x.id} ${x.detail ?? ""}`);
    }
  } finally {
    await browser.close();
    app.stop();
  }
  const summary = { suite: "render-v1", environment: `chromium ${browser.version()}`, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), mismatches: bad, rows };
  if (values.out) writeFileSync(resolve(values.out), JSON.stringify(summary, null, 2) + "\n");
  console.log(bad ? `対照の不一致 ${bad} 件` : "対照はすべて期待どおり");
  process.exit(bad ? 1 : 0);
}
if (import.meta.main) await main();
