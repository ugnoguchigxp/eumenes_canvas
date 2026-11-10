// render-v1 の判定と集計（評価担当）。全反復の制作が終わってから、保存された最終版を eval/checks/render.ts で判定する。
//   bun eval/render/grade.ts --root /workspace/canvas_render [--allow-partial] [--port 4782]
// 結果は <root>/grade/grades.json と <root>/grade/summary.json（制作担当の実行ディレクトリの外）。制作担当には渡さない。
// 判定には候補が宣言した libraries をそのまま使う（課題の libraries は参照の作品のもの）。平均は課題群をまたいで混ぜない。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import type { ArtworkBody } from "../../src/contract/artwork";
import { startApp } from "../../src/server/app";
import { RENDER_CHECKS } from "../checks/render";
import { EvalEnv, type CheckResult } from "../lib/env";
import { RENDER_TASKS } from "./suite";

interface TaskRecord {
  run: string;
  task: string;
  presented: boolean;
  submissions: number;
  turns: { state: string; failure: string | null }[];
  final: ArtworkBody | null;
  error: string | null;
}
export interface RenderGrade {
  run: string;
  task: string;
  group: string;
  presented: boolean;
  submissions: number;
  libraries: string[];
  pass: boolean;
  checks: CheckResult[];
}

async function main() {
  const { values } = parseArgs({ options: { root: { type: "string" }, "allow-partial": { type: "boolean" }, port: { type: "string" } } });
  const root = resolve(values.root ?? "/workspace/canvas_render");
  const runs = readdirSync(root).filter((d) => /^D-r\d+$/.test(d)).sort();
  const missing = runs.filter((d) => !existsSync(join(root, d, "host/DONE")));
  if (missing.length && !values["allow-partial"]) throw new Error(`制作が終わっていない実行: ${missing.join(", ")}（全反復の制作が終わってから判定する）`);
  for (const d of runs) {
    const rj = join(root, d, "host/run.json");
    if (existsSync(rj) && JSON.parse(readFileSync(rj, "utf8")).suite !== "render") throw new Error(`${d} は render の実行ではない`);
  }
  const port = Number(values.port ?? 4782);
  const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
  const browser = await chromium.launch({ args: ["--mute-audio"] });
  const env = new EvalEnv(browser, app.hostOrigin);
  const grades: RenderGrade[] = [];
  try {
    for (const run of runs) {
      const f = join(root, run, "host/results.json");
      if (!existsSync(f)) continue;
      for (const r of (JSON.parse(readFileSync(f, "utf8")) as { records: TaskRecord[] }).records) {
        const t = RENDER_TASKS.find((x) => x.id === r.task);
        if (!t) throw new Error(`render-v1 にない課題: ${r.task}`);
        const libs = r.final?.libraries ?? [];
        const g: RenderGrade = { run, task: r.task, group: t.group, presented: r.presented, submissions: r.submissions, libraries: libs, pass: false, checks: [] };
        if (!r.presented || !r.final) g.checks = [{ id: "presented", kind: "start", pass: false, detail: "提示・保存に至らない: " + (r.error ?? r.turns.at(-1)?.failure ?? "") }];
        else {
          g.checks = await RENDER_CHECKS[t.id](env, r.final.entry, libs, t.seed);
          g.pass = g.checks.length > 0 && g.checks.every((c) => c.pass);
        }
        grades.push(g);
        console.log(`${g.pass ? "合格" : "不合格"} ${run} ${r.task}（libraries: ${libs.join(",") || "なし"}）`);
        for (const c of g.checks) if (!c.pass) console.log(`      × [${c.kind}] ${c.id} ${c.detail ?? ""}`);
      }
    }
  } finally {
    await browser.close();
    app.stop();
  }
  const groups: Record<string, { pass: number; n: number }> = {};
  for (const g of grades) {
    groups[g.group] ??= { pass: 0, n: 0 };
    groups[g.group].n++;
    if (g.pass) groups[g.group].pass++;
  }
  const perTask = RENDER_TASKS.map((t) => {
    const gs = grades.filter((g) => g.task === t.id);
    const failed: Record<string, number> = {};
    for (const g of gs) for (const c of g.checks) if (!c.pass) failed[c.id] = (failed[c.id] ?? 0) + 1;
    const libs: Record<string, number> = {};
    for (const g of gs) libs[g.libraries.join(",") || "なし"] = (libs[g.libraries.join(",") || "なし"] ?? 0) + 1;
    return { task: t.id, group: t.group, pass: gs.filter((g) => g.pass).length, presented: gs.filter((g) => g.presented).length, n: gs.length, failedChecks: failed, libraries: libs };
  });
  const summary = { suite: "render-v1", gradedAt: new Date().toISOString(), environment: `chromium ${browser.version()}`, partial: missing, runs, groups, perTask };
  mkdirSync(join(root, "grade"), { recursive: true });
  writeFileSync(join(root, "grade/grades.json"), JSON.stringify({ environment: summary.environment, gradedAt: summary.gradedAt, partial: missing, grades }, null, 2));
  writeFileSync(join(root, "grade/summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ groups }, null, 1));
  process.exit(0);
}
if (import.meta.main) await main();
