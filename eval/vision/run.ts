/// <reference lib="dom.asynciterable" />
// A trial shares its actual initial candidate between the two conditions.
// This gateway only forwards requests; it never supplies a production candidate.
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { TASKS } from "./suite";

const { values } = parseArgs({ options: { root: { type: "string" }, concurrency: { type: "string" }, smoke: { type: "boolean" } } });
const root = resolve(values.root ?? "eval/out/vision");
const repository = resolve(import.meta.dir, "../..");
const concurrency = Number(values.concurrency ?? 4);
if (![1,2,3,4,5].includes(concurrency)) throw new Error("並行数は1〜5");
const key = values.smoke ? undefined : process.env.OPEN_AI_API_KEY;
if (!values.smoke && !key) throw new Error("環境変数 OPEN_AI_API_KEY を設定してください");
if (!values.smoke) {
  const controls = JSON.parse(await readFile(join(root,"controls.json"),"utf8")) as {rows: {ok:boolean}[]};
  if (controls.rows.length !== TASKS.length*2 || controls.rows.some((r)=>!r.ok)) throw new Error("凍結前の対照を確認してください");
}
const model = "gpt-6-luna";
const reasoningEffort = "low";
const taskTimeMs = 180_000;
const repetitions = values.smoke ? [1] : [1,2,3];
const tasks = values.smoke ? TASKS.filter((t)=>t.id==="H-M3-copy") : TASKS;
const trials = repetitions.flatMap((rep)=>tasks.map((task)=>({rep,task})));

type Call = { phase: "initial" | "judge" | "repair"; status:number; model?:string; usage?:unknown; ms?:number };
type Scope = { task: typeof TASKS[number]; started: number; calls: Call[] };
const scopes = new Map<string,Scope>();

const server = Bun.serve({
  port:0, hostname:"127.0.0.1", idleTimeout:125,
  async fetch(req) {
    const match = /^\/([\da-f-]+)\/(maker|vision)\/chat\/completions$/.exec(new URL(req.url).pathname);
    const scope = match && scopes.get(match[1]);
    if (!scope || req.method!=="POST") return new Response("not found",{status:404});
    try {
      const raw = await req.text();
      if (Buffer.byteLength(raw) > (match[2]==="vision" ? 500_000 : 65_536)) return new Response("request limit",{status:400});
      const body = JSON.parse(raw) as { model:string; reasoning_effort:string; store:boolean; max_completion_tokens:number; messages:{role:string;content:unknown}[] };
      if (body.model!==model || body.reasoning_effort!==reasoningEffort || body.store!==false ||
        !Number.isInteger(body.max_completion_tokens) || body.max_completion_tokens<1 || body.max_completion_tokens>8192)
        return new Response("configuration mismatch",{status:400});
      const content = body.messages.find((m)=>m.role==="user")?.content;
      const phase: Call["phase"] = match[2]==="vision" ? "judge" :
        typeof content==="string" && content.startsWith("## 依頼\n現在の保存版を修正してください。") ? "repair" : "initial";
      const count = scope.calls.filter((c)=>c.phase===phase).length;
      if (count >= (phase==="judge"?1:3)) return new Response("phase call limit",{status:429});
      if ((phase==="judge" && !Array.isArray(content)) || (phase!=="judge" && typeof content!=="string"))
        return new Response("message type mismatch",{status:400});
      const remaining = taskTimeMs-(Date.now()-scope.started);
      if (remaining<=0) return new Response("trial time limit",{status:408});
      const t0 = Date.now();
      const call:Call = {phase,status:0};
      scope.calls.push(call);
      if (values.smoke) {
        if (phase!=="judge" && !(content as string).includes("## 基準の作品（保存版）")) throw new Error("元作品が制作依頼に含まれない");
        const fake = phase==="judge" ? { verdict:"pass",evidence:"固定対照" } : {
          ...scope.task.reference, spec:{requirements:["貼り付けで色を保持する"],controls:[]}, changes:"対照",unconfirmed:[],reply:"候補を作りました。",
        };
        call.status=200; call.model=model; call.ms=Date.now()-t0;
        return Response.json({model,choices:[{message:{content:JSON.stringify(fake)}}]});
      }
      const response = await fetch("https://api.openai.com/v1/chat/completions",{
        method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:raw,redirect:"error",
        signal:AbortSignal.any([req.signal,AbortSignal.timeout(Math.min(120_000,remaining))]),
      });
      call.status=response.status;
      const json=await response.json() as {model?:string;usage?:unknown};
      call.model=json.model;
      call.usage=json.usage;
      call.ms=Date.now()-t0;
      return Response.json(json,{status:response.status});
    } catch {
      return new Response("provider gateway failed",{status:502});
    }
  },
});

async function runTrial({rep,task}: typeof trials[number]) {
  const dir=join(root,`r${rep}`,task.id);
  await mkdir(join(root,`r${rep}`),{recursive:true});
  await mkdir(dir,{mode:0o700});
  const id=randomUUID();
  const scope:Scope={task,started:Date.now(),calls:[]};
  const common={model,reasoningEffort,maxCompletionTokens:8192,timeoutMs:120_000,store:false};
  const cfg={
    hostPort:4300,previewPort:4301,dataDir:null,runTimeoutMs:taskTimeMs,singleUser:true,datasets:[],
    model:{...common,provider:"openai-compatible",label:"Luna low",baseUrl:new URL(`${id}/maker`,server.url).href},
    review:{mode:"off"},
  };
  const vision={...common,maxCompletionTokens:2048,baseUrl:new URL(`${id}/vision`,server.url).href};
  const canvasConfig=join(dir,"canvas.json"), visionConfig=join(dir,"vision.json"), baseFile=join(dir,"base.json");
  await writeFile(canvasConfig,JSON.stringify(cfg,null,2),{mode:0o600});
  await writeFile(visionConfig,JSON.stringify(vision,null,2),{mode:0o600});
  if (task.base) await writeFile(baseFile,JSON.stringify(task.base,null,2),{mode:0o600});
  scopes.set(id,scope);
  const log=createWriteStream(join(dir,"browser.log"),{flags:"wx",mode:0o600});
  scope.started=Date.now();
  const proc=Bun.spawn([
    process.execPath,join(repository,"examples/interact/run.ts"),"--canvas-config",canvasConfig,"--vision-config",visionConfig,
    "--request",task.request,"--verify",task.visual,"--repair","--archive","--out",join(dir,"artifacts"),
    ...task.keys.flatMap((key)=>["--key",key]),...(task.base?["--base",baseFile]:[]),
  ],{cwd:repository,stdout:"pipe",stderr:"pipe"});
  const captureLog=async (stream: ReadableStream<Uint8Array>)=>{
    for await (const chunk of stream) log.write(chunk);
  };
  const pipes=Promise.all([captureLog(proc.stdout),captureLog(proc.stderr)]);
  let timeout=false;
  let force: ReturnType<typeof setTimeout>|undefined;
  const timer=setTimeout(()=>{
    timeout=true;
    proc.kill("SIGTERM");
    force=setTimeout(()=>proc.kill("SIGKILL"),10_000);
  },taskTimeMs);
  try {
    const exit=await proc.exited;
    await pipes;
    const beforeMs=await stat(join(dir,"artifacts/before.json")).then((s)=>Math.round(s.mtimeMs-scope.started)).catch(()=>null);
    await writeFile(join(dir,"run.json"),JSON.stringify({
      task:task.id,rep,exit,timeout,wallMs:Date.now()-scope.started,beforeMs,calls:scope.calls,
    },null,2)+"\n",{flag:"wx",mode:0o600});
    console.log(`r${rep} ${task.id} exit=${exit} ${scope.calls.map((c)=>c.phase).join(",")} ${timeout?"timeout":""}`);
  } finally {
    clearTimeout(timer);
    if (force) clearTimeout(force);
    log.end();
    scopes.delete(id);
  }
}

try {
  let next=0;
  const outcomes=await Promise.allSettled(Array.from({length:concurrency},async()=>{
    for (;;) {
      const i=next++;
      if (i>=trials.length) return;
      await runTrial(trials[i]);
    }
  }));
  const failures=outcomes.filter((o)=>o.status==="rejected");
  if (failures.length) throw new Error(failures.map((f)=>String(f.reason)).join(" / "));
  await writeFile(join(root,"DONE"),new Date().toISOString(),{flag:"wx"});
} finally {
  server.stop(true);
}
