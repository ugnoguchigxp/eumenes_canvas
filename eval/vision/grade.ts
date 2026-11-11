import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { artworkDigest, type ArtworkBody } from "../../src/contract/artwork";
import { startApp } from "../../src/server/app";
import { EvalEnv, hex } from "../lib/env";
import { TASKS, type VisionTask } from "./suite";

const { values } = parseArgs({ options: { root: { type: "string" }, port: { type: "string" }, controls: { type: "boolean" }, rep: { type: "string" } } });
const root = resolve(values.root ?? "eval/out/vision");
const port = Number(values.port ?? 5050);
const app = startApp({ hostPort: port, previewPort: port + 1, devHarness: true });
const browser = await chromium.launch({ args: ["--mute-audio"] });
const env = new EvalEnv(browser, app.hostOrigin);
const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));

async function grade(task: VisionTask, body: ArtworkBody) {
  const checks: { name: string; pass: boolean; details: string[] }[] = [];
  try {
    const result = await env.start(body.entry, null, 1, { libraries: body.libraries });
    if (result.type !== "ready") throw new Error("プレビューの起動に失敗");
    for (const check of task.checks) {
      for (const action of check.actions) {
        if (typeof action === "string") await env.press(action.startsWith("Digit") ? action.slice(5) : action);
        else if (typeof action === "number") await env.advance(action);
        else await env.hold(action.hold, action.ms);
      }
      await env.advance(0);
      const shot = await env.shot();
      const details = check.pixels.flatMap(([x,y,c]) => {
        const i = 4*(y*shot.w+x);
        return hex(c).every((value, offset) => Math.abs(shot.data[i+offset]-value)<=12)
          ? [] : [`(${x},${y}) #${shot.data.subarray(i,i+3).toString("hex")}、期待 ${c}`];
      });
      checks.push({ name: check.name, pass: details.length === 0, details });
    }
    const errors = await env.collectErrors();
    if (errors.length) checks.push({ name:"実行時エラー",pass:false,details:errors });
  } catch (error) {
    checks.push({ name:"実行",pass:false,details:[String((error as Error)?.message ?? error)] });
  } finally {
    await env.close();
  }
  return { pass: checks.length === task.checks.length && checks.every((c)=>c.pass), checks };
}

type Capture = { captureId: string; fileName: string; sha256: string };
type Archive = { body: ArtworkBody; digest: string; captureId: string; screenshotSha256: string };
async function verifyArchive(dir: string, phase: "before" | "after", capture?: Capture) {
  const archive = json<Archive>(join(dir,`${phase}.json`));
  if (await artworkDigest(archive.body) !== archive.digest) throw new Error("保存版digestが一致しない");
  if (capture && (archive.captureId !== capture.captureId || archive.screenshotSha256 !== capture.sha256 ||
    createHash("sha256").update(readFileSync(join(dir,capture.fileName))).digest("hex") !== capture.sha256))
    throw new Error("保存版と撮影の対応が一致しない");
  return archive;
}
const missing = (reason: string) => ({ pass:false, checks:[{name:"提示・保存",pass:false,details:[reason]}] });

try {
  if (values.controls) {
    const rows = [];
    for (const task of TASKS) {
      for (const [kind, body] of [["reference",task.reference],["negative",task.base ?? task.negative!]] as const) {
        const result = await grade(task,body);
        rows.push({ task:task.id, kind, ok: kind==="reference" ? result.pass : !result.pass && result.checks.some((c)=>c.name!=="実行"&&!c.pass), result });
      }
    }
    mkdirSync(root,{recursive:true});
    writeFileSync(join(root,"controls.json"),JSON.stringify({browser:browser.version(),rows},null,2));
    console.log(`対照 ${rows.filter((r)=>r.ok).length}/${rows.length}`);
    for (const row of rows.filter((r)=>!r.ok)) console.log(JSON.stringify(row));
    if (rows.some((r)=>!r.ok)) process.exitCode=1;
  } else {
    const rep = Number(values.rep);
    if (![1,2,3].includes(rep)) throw new Error("--rep 1|2|3 が必要");
    const rows = [];
    for (const task of TASKS) {
      const trial = join(root,`r${rep}`,task.id);
      const dir = join(trial,"artifacts");
      const run = json<{ exit:number; timeout:boolean; calls:{phase:string; status:number; model?:string}[] }>(join(trial,"run.json"));
      const reportFile = join(dir,"report.json");
      const report = existsSync(reportFile) ? json<{capture:Capture; independentJudgments:number; verification:{verdict:string;evidence:string}|null; repair:{status:string;capture:Capture|null;error:string|null}}>(reportFile) : null;
      const judgeCalls = run.calls.filter((c)=>c.phase==="judge").length;
      if (judgeCalls>1 || (report && report.independentJudgments!==judgeCalls)) throw new Error(`${task.id}: 独立判定回数が一致しない`);
      let baseline = missing("初回候補を保存できなかった"), candidate = missing("修正経路が完了しなかった");
      if (existsSync(join(dir,"before.json"))) {
        const before = await verifyArchive(dir,"before",report?.capture);
        baseline = await grade(task,before.body);
        if (!run.timeout && report?.repair.status==="skipped") candidate = baseline;
        if (!run.timeout && report?.repair.status==="replayed" && report.repair.capture) {
          const after = await verifyArchive(dir,"after",report.repair.capture);
          candidate = await grade(task,after.body);
        }
      }
      rows.push({task:task.id,group:task.group,rep,baseline,candidate,judgeCalls,verdict:report?.verification?.verdict ?? null,repair:report?.repair.status ?? null});
      console.log(`${task.id} ${Number(baseline.pass)}→${Number(candidate.pass)} ${report?.verification?.verdict ?? "なし"}`);
    }
    writeFileSync(join(root,`r${rep}-grades.json`),JSON.stringify({browser:browser.version(),rows},null,2));
  }
} finally {
  await browser.close();
  app.stop();
}
