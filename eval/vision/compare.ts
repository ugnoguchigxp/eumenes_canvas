import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { TASKS } from "./suite";

type Grade = { pass:boolean; checks:{name:string;pass:boolean;details:string[]}[] };
type Row = { task:string; group:string; rep:number; baseline:Grade; candidate:Grade; judgeCalls:number; verdict:string|null; repair:string|null };
type Trial = { task:string; rep:number; exit:number; timeout:boolean; wallMs:number; beforeMs:number|null; calls:{phase:string;status:number;model?:string}[] };
const root=resolve(process.argv[2] ?? "eval/out/vision");
const json=<T>(path:string):T=>JSON.parse(readFileSync(join(root,path),"utf8"));
readFileSync(join(root,"DONE"));
const controls=json<{rows:{ok:boolean}[]}>("controls.json").rows;
if(controls.length!==TASKS.length*2||controls.some((r)=>!r.ok)) throw new Error("対照の記録が不足");
const gradeFiles=[1,2,3].map((rep)=>json<{browser:string;rows:Row[]}>(`r${rep}-grades.json`));
const rows=gradeFiles.flatMap((f)=>f.rows);
if (new Set(gradeFiles.map((f)=>f.browser)).size!==1) throw new Error("採点ブラウザが一致しない");
if(rows.length!==TASKS.length*3||TASKS.some((t)=>[1,2,3].some((rep)=>rows.filter((r)=>r.task===t.id&&r.rep===rep).length!==1)))
  throw new Error("採点行の不足・重複");
const runs=rows.map((r)=>{
  const run=json<Trial>(`r${r.rep}/${r.task}/run.json`);
  if(run.task!==r.task||run.rep!==r.rep||run.calls.filter((c)=>c.phase==="judge").length!==r.judgeCalls||
     r.judgeCalls>1||["initial","repair"].some((phase)=>run.calls.filter((c)=>c.phase===phase).length>3)||
     run.calls.some((c)=>c.status===200&&c.model!=="gpt-6-luna"))
    throw new Error(`呼出し記録の不一致 ${r.rep}/${r.task}`);
  return run;
});
const tally=(rs:Row[],mode:"baseline"|"candidate")=>({pass:rs.filter((r)=>r[mode].pass).length,n:rs.length});
const games=rows.filter((r)=>r.group!=="nongame");
const p90=(n:number[])=>n.length?n.sort((a,b)=>a-b)[Math.ceil(n.length*0.9)-1]:null;
function condition(mode:"baseline"|"candidate"){
  const groups=Object.fromEntries(["new","modify","repair","nongame"].map((g)=>[g,tally(rows.filter((r)=>r.group===g),mode)]));
  const tasks=Object.fromEntries(TASKS.map((t)=>[t.id,tally(rows.filter((r)=>r.task===t.id),mode)]));
  const samples=rows.flatMap((r,i)=>{
    if(!r[mode].pass) return [];
    const ms=mode==="baseline"?runs[i].beforeMs:runs[i].wallMs;
    return ms===null?[]:[ms];
  });
  return {games:tally(games,mode),groups,tasks,p90Ms:p90(samples),qualityGate:tally(games,mode).pass>=32&&
    ["new","modify","repair"].every((g)=>groups[g].pass>=10)&&Object.values(tasks).every((t)=>t.pass>=2)};
}
const label=(r:Row)=>({rep:r.rep,task:r.task,group:r.group});
const result={
  browser:gradeFiles[0].browser, controls:controls.length,trials:rows.length,
  baseline:condition("baseline"),candidate:condition("candidate"),
  improved:rows.filter((r)=>!r.baseline.pass&&r.candidate.pass).map(label),
  regressed:rows.filter((r)=>r.baseline.pass&&!r.candidate.pass).map(label),
  judgments:rows.reduce((n,r)=>n+r.judgeCalls,0),
  maxJudgmentsPerTaskTrial:Math.max(...rows.map((r)=>r.judgeCalls)),
  verdicts:Object.fromEntries(["pass","fail","unknown","none"].map((v)=>[v,rows.filter((r)=>(r.verdict??"none")===v).length])),
  replayed:rows.filter((r)=>r.repair==="replayed").length,
  repairFailed:rows.filter((r)=>r.repair==="failed").map(label),
  baselineSaved:runs.filter((r)=>r.beforeMs!==null).length,
  timeouts:runs.filter((r)=>r.timeout).map(({rep,task})=>({rep,task})),
  calls:Object.fromEntries(["initial","judge","repair"].map((phase)=>[phase,runs.flatMap((r)=>r.calls).filter((c)=>c.phase===phase).length])),
  apiErrors:runs.flatMap((r)=>r.calls).filter((c)=>c.status!==200).length,
  failures:rows.filter((r)=>!r.baseline.pass||!r.candidate.pass).map((r)=>({
    ...label(r),verdict:r.verdict,repair:r.repair,baseline:r.baseline.checks.filter((c)=>!c.pass),candidate:r.candidate.checks.filter((c)=>!c.pass),
  })),
};
writeFileSync(join(root,"summary.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({baseline:result.baseline.games,candidate:result.candidate.games,improved:result.improved,regressed:result.regressed,verdicts:result.verdicts,calls:result.calls},null,2));
