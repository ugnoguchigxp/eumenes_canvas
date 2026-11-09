// general-v1 の判定の自己確認（評価担当）。生成ランの前に通す。
//   bun eval/general/self-test.ts [--task ID] [--out docs/eval/general-v1-self-test.json]
// 対照：黒一色（全観点が不合格）、元作品・不具合入りの元作品（change が 1 つ以上不合格・他は合格）、修復済み・参照の作品（全観点が合格）。
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { startApp } from "../../src/server/app";
import { CHECKS } from "../checks/general";
import { EvalEnv, type CheckResult } from "../lib/env";
import { EVAL, GENERAL_TASKS, generalData } from "./suite";

const BLANK = `canvasApp.start((api) => ({ frame() { api.ctx.fillStyle = "#000000"; api.ctx.fillRect(0, 0, api.width, api.height); } }));`;
type Expect = "all-pass" | "change-fails" | "all-fail";
interface Control { task: string; name: string; entry: string; data: unknown; expect: Expect }

export function controls(): Control[] {
  const out: Control[] = [];
  for (const t of GENERAL_TASKS) {
    const d = generalData(t.dataRef);
    const file = (p: string) => readFileSync(join(EVAL, p), "utf8");
    out.push({ task: t.id, name: "黒一色", entry: BLANK, data: d, expect: "all-fail" });
    if (t.base) out.push({ task: t.id, name: `元作品 ${t.base}`, entry: file(t.base), data: d, expect: "change-fails" });
    if (t.fixed) out.push({ task: t.id, name: `修復済み ${t.fixed}`, entry: file(t.fixed), data: d, expect: "all-pass" });
    if (!t.fixed) out.push({ task: t.id, name: `参照 gold/general/${t.id}.js`, entry: file(`gold/general/${t.id}.js`), data: d, expect: "all-pass" });
  }
  return out;
}

export function judge(e: Expect, r: CheckResult[]) {
  if (!r.length) return false;
  if (e === "all-pass") return r.every((x) => x.pass);
  if (e === "all-fail") return r.every((x) => !x.pass);
  return r.some((x) => x.kind === "change" && !x.pass) && r.filter((x) => x.kind !== "change").every((x) => x.pass);
}

async function main() {
  const { values } = parseArgs({ options: { task: { type: "string" }, out: { type: "string" }, port: { type: "string" } } });
  const port = Number(values.port ?? 4780);
  const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
  const browser = await chromium.launch({ args: ["--mute-audio"] });
  const env = new EvalEnv(browser, app.hostOrigin);
  const rows: unknown[] = [];
  let bad = 0;
  try {
    for (const c of controls()) {
      if (values.task && c.task !== values.task) continue;
      const t = GENERAL_TASKS.find((x) => x.id === c.task)!;
      const r = await CHECKS[t.id](env, c.entry, c.data, t.seed);
      const ok = judge(c.expect, r);
      if (!ok) bad++;
      rows.push({ task: c.task, name: c.name, expect: c.expect, ok, checks: r });
      console.log(`${ok ? "OK  " : "NG  "} ${c.task} ${c.name}（期待 ${c.expect}）`);
      for (const x of r) console.log(`      ${x.pass ? "○" : "×"} [${x.kind}] ${x.id} ${x.detail ?? ""}`);
    }
  } finally {
    await browser.close();
    app.stop();
  }
  const summary = { suite: "general-v1", environment: `chromium ${browser.version()}`, at: new Date().toISOString(), mismatches: bad, rows };
  if (values.out) writeFileSync(resolve(values.out), JSON.stringify(summary, null, 2));
  console.log(bad ? `対照の不一致 ${bad} 件` : "対照はすべて期待どおり");
  process.exit(bad ? 1 : 0);
}
if (import.meta.main) await main();
