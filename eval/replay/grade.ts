// Run after generation. This module and its checks are never loaded by the maker runner.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { startApp } from "../../src/server/app";
import { EvalEnv, type CheckResult } from "../lib/env";
import type { TaskRecord } from "../p3/run";
import { gradeTurn } from "./checks";
import { ALTERNATIVE, BROKEN, GOOD } from "./controls";
import { REPLAY_TASKS } from "./suite";

const { values } = parseArgs({ options: { root: { type: "string" }, port: { type: "string" }, "self-test": { type: "boolean" }, run: { type: "string" } } });
const root = resolve(values.root ?? "eval/out/replay");
const port = Number(values.port ?? 4780);
const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
const browser = await chromium.launch({ args: ["--mute-audio"] });
const env = new EvalEnv(browser, app.hostOrigin);
try {
  if (values["self-test"]) {
    const rows = [];
    for (const task of REPLAY_TASKS) {
      for (const [i, good] of GOOD[task.id].entries()) {
        const checks = await gradeTurn(env, task, i, good.entry);
        rows.push({ task: task.id, i, case: "reference", ok: checks.every((c) => c.pass), checks });
      }
      const wrong = task.start ?? BROKEN[task.id];
      const checks = await gradeTurn(env, task, 0, wrong.entry);
      rows.push({ task: task.id, case: "negative", ok: checks.some((c) => !c.pass), checks });
    }
    const task = REPLAY_TASKS.find((t) => t.id === "F-N4-reaction")!;
    const checks = await gradeTurn(env, task, 0, ALTERNATIVE.entry);
    rows.push({ task: task.id, case: "alternative", ok: checks.every((c) => c.pass), checks });
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "controls.json"), JSON.stringify({ browser: browser.version(), rows }, null, 2));
    console.log(`対照 ${rows.filter((r)=>r.ok).length}/${rows.length}`);
    for (const row of rows.filter((r) => !r.ok)) console.log(JSON.stringify(row));
    if (rows.some((r)=>!r.ok)) process.exitCode = 1;
  } else {
    if (!values.run) throw new Error("--run が必要");
    const run = values.run;
    readFileSync(join(root, run, "host/DONE"));
    const { records } = JSON.parse(readFileSync(join(root, run, "host/results.json"), "utf8")) as { records: TaskRecord[] };
    if (records.length !== REPLAY_TASKS.length || REPLAY_TASKS.some((t) => records.filter((r) => r.task === t.id).length !== 1))
      throw new Error("課題の件数が一致しない");
    const grades = [];
    for (const task of REPLAY_TASKS) {
      const r = records.find((item) => item.task === task.id)!;
      const checks: CheckResult[] = [];
      if (!r.presented || r.turns.length !== task.turns.length || r.turns.some((t)=>!t.saved)) {
        checks.push({ id: "提示・保存", kind: "start", pass: false, detail: r.error ?? r.turns.at(-1)?.failure ?? "" });
      } else {
        for (const [index, turn] of r.turns.entries()) {
          for (const check of await gradeTurn(env, task, index, turn.saved!.entry))
            checks.push({ ...check, id: `${index+1}:${check.id}` });
        }
      }
      const pass = checks.length > 0 && checks.every((c) => c.pass);
      grades.push({ task: task.id, group: task.group, run, pass, checks, presented: r.presented, ms: r.turns.reduce((ms,t)=>ms+t.wallMs,0), calls: r.calls, evalCalls: r.evalCalls });
      console.log(`${pass?"合格":"不合格"} ${task.id}`);
    }
    mkdirSync(join(root, run, "grade"), { recursive: true });
    writeFileSync(join(root, run, "grade/grades.json"), JSON.stringify({ browser: browser.version(), grades }, null, 2));
  }
} finally {
  await browser.close();
  app.stop();
}
