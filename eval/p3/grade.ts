// P3 の判定（評価担当）。全条件・全反復の制作が終わってから、保存された最終版を判定 v1（正式）と v2（N3 だけ変えた参考）で調べる。
//   bun eval/p3/grade.ts --root /workspace/canvas_p3 [--allow-partial]
// 結果は <root>/grade/grades.json（制作担当の実行ディレクトリの外）。制作担当には渡さない。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { startApp } from "../../src/server/app";
import { CHECKS as V2 } from "../checks/heldout";
import { EvalEnv, type CheckResult } from "../lib/env";
import { CHECKS as V1 } from "./checks-v1";
import { DATASETS, TASKS } from "./run";
import type { TaskRecord } from "./run";

export interface Grade {
  cond: string;
  run: string;
  task: string;
  group: string;
  presented: boolean;
  v1: { pass: boolean; checks: CheckResult[] };
  v2: { pass: boolean; checks: CheckResult[] } | null;
}

async function main() {
  const { values } = parseArgs({ options: { root: { type: "string" }, "allow-partial": { type: "boolean" }, port: { type: "string" } } });
  const root = resolve(values.root ?? "/workspace/canvas_p3");
  const runs = readdirSync(root).filter((d) => /^[DCP]-r\d+$/.test(d)).sort();
  const missing = runs.filter((d) => !existsSync(join(root, d, "host/DONE")));
  if (missing.length && !values["allow-partial"]) throw new Error(`制作が終わっていない実行: ${missing.join(", ")}（全条件の制作が終わってから判定する）`);
  const port = Number(values.port ?? 4760);
  const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
  const browser = await chromium.launch({ args: ["--mute-audio"] });
  const env = new EvalEnv(browser, app.hostOrigin);
  const grades: Grade[] = [];
  try {
    for (const run of runs) {
      const f = join(root, run, "host/results.json");
      if (!existsSync(f)) continue;
      const recs = (JSON.parse(readFileSync(f, "utf8")) as { records: TaskRecord[] }).records;
      for (const r of recs) {
        const t = TASKS.find((x) => x.id === r.task)!;
        const data = r.final?.dataRef ? (DATASETS.find((d) => d.ref === r.final!.dataRef)?.data ?? null) : null;
        const g: Grade = { cond: r.cond, run: r.run, task: r.task, group: r.group, presented: r.presented, v1: { pass: false, checks: [] }, v2: null };
        if (!r.presented || !r.final) g.v1.checks = [{ id: "presented", kind: "start", pass: false, detail: "提示・保存に至らない: " + (r.error ?? r.turns.at(-1)?.failure ?? "") }];
        else {
          g.v1.checks = await V1[t.id](env, r.final.entry, data, t.seed);
          g.v1.pass = g.v1.checks.length > 0 && g.v1.checks.every((c) => c.pass);
          if (t.id === "N3-shooter") {
            const c2 = await V2[t.id](env, r.final.entry, data, t.seed);
            g.v2 = { pass: c2.length > 0 && c2.every((c) => c.pass), checks: c2 };
          }
        }
        grades.push(g);
        console.log(`${g.v1.pass ? "合格" : "不合格"} ${run} ${r.task}${g.v2 ? `（v2 ${g.v2.pass ? "合格" : "不合格"}）` : ""}`);
        for (const c of g.v1.checks) if (!c.pass) console.log(`      × [${c.kind}] ${c.id} ${c.detail ?? ""}`);
      }
    }
  } finally {
    await browser.close();
    app.stop();
  }
  mkdirSync(join(root, "grade"), { recursive: true });
  writeFileSync(join(root, "grade/grades.json"), JSON.stringify({ environment: `chromium ${browser.version()}`, gradedAt: new Date().toISOString(), partial: missing, grades }, null, 2));
  process.exit(0);
}
if (import.meta.main) await main();
