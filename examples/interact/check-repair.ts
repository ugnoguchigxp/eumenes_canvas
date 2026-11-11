// Runs the example against a known visual defect. --live uses Luna low for the two
// decisions following the supplied initial artwork: one judgment and one repair.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";

const { values } = parseArgs({ options: { live: { type: "boolean" }, out: { type: "string" } } });
const key = values.live ? process.env.OPEN_AI_API_KEY : undefined;
if (values.live && !key) throw new Error("環境変数 OPEN_AI_API_KEY を設定してください");

const root = resolve(import.meta.dir, "../..");
const outputRoot = join(root, "eval/out");
await mkdir(outputRoot, { recursive: true });
const out = values.out ? resolve(values.out) : join(await mkdtemp(join(outputRoot, "interact-repair-")), "artifacts");
const tmp = await mkdtemp(join(tmpdir(), "interact-repair-config-"));
const request = "黒い背景に40×40の青い正方形を左半分の中央に表示してください。Spaceを1回押したら右半分の中央に移動して黄色になります。Rで左半分に戻って青に戻ります。青は#0000ff、黄は#ffff00を使ってください。";
const condition = "Spaceを1回押したあとの画像で、黒い背景の右半分に黄色い正方形が見える。";
const title = "左右のマーカー";
const makeArtwork = (correct: boolean) => ({
  title,
  entry: `canvasApp.start(api => {
    let moved = false;
    return {
      frame() {
        const c = api.ctx;
        c.fillStyle = "#000000";
        c.fillRect(0, 0, api.width, api.height);
        c.fillStyle = moved && ${correct} ? "#ffff00" : "#0000ff";
        c.fillRect(api.width * (moved ? 0.75 : 0.25) - 20, api.height / 2 - 20, 40, 40);
      },
      input(e) {
        if (e.type !== "keydown") return;
        if (e.code === "Space") moved = true;
        if (e.code === "KeyR") moved = false;
      }
    };
  });`,
  spec: { requirements: ["Spaceで右半分へ移動して黄色になる", "Rで青に戻る"], controls: [] },
  changes: "マーカーの操作", unconfirmed: [], reply: "候補を作りました。",
});

const countColor = (png: PNG, side: "left" | "right", color: number[]) => {
  let count = 0;
  const middle = Math.floor(png.width / 2);
  for (let y = 0; y < png.height; y++) {
    for (let x = side === "right" ? middle : 0; x < (side === "right" ? png.width : middle); x++) {
      const offset = 4 * (y * png.width + x);
      if (color.every((value, i) => png.data[offset + i] === value)) count++;
    }
  }
  return count;
};

const reply = (message: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(message) } }] });
const providerCalls: { purpose: "judge" | "repair"; status: number; model?: string }[] = [];
const forward = async (purpose: "judge" | "repair", body: unknown) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(75_000),
  });
  const json = await response.json() as { model?: string };
  providerCalls.push({ purpose, status: response.status, model: json.model });
  // fetch はレスポンスを展開する。中継では上流の Content-Encoding を引き継がない。
  return Response.json(json, { status: response.status });
};

let makerCalls = 0;
let judgeCalls = 0;
let judgedImage: Buffer | undefined;
const gateway = Bun.serve({
  port: 0, hostname: "127.0.0.1", idleTimeout: 85,
  async fetch(req) {
    try {
      const body = await req.json() as { messages: { role: string; content: unknown }[]; store: boolean };
      const content = body.messages.find((m) => m.role === "user")?.content;
      if (new URL(req.url).pathname === "/maker/chat/completions") {
        makerCalls++;
        if (makerCalls === 1) return reply(makeArtwork(false));
        assert.equal(makerCalls, 2, "修正は一度だけ");
        assert.equal(typeof content, "string");
        assert.match(content as string, /## 基準の作品（保存版）/u);
        assert.ok((content as string).includes(condition));
        return values.live ? await forward("repair", body) : reply(makeArtwork(true));
      }
      if (new URL(req.url).pathname === "/vision/chat/completions") {
        judgeCalls++;
        assert.equal(judgeCalls, 1, "独立した判定は一度だけ");
        assert.equal(body.store, false);
        assert.ok(Array.isArray(content));
        const url = content.find((item) => item.type === "image_url")?.image_url?.url as string;
        assert.ok(url.startsWith("data:image/png;base64,"));
        judgedImage = Buffer.from(url.slice("data:image/png;base64,".length), "base64");
        const png = PNG.sync.read(judgedImage);
        assert.ok(countColor(png, "right", [0, 0, 255]) >= 1000, "Space再生で青い正方形が右へ移った");
        assert.equal(countColor(png, "left", [0, 0, 255]), 0);
        return values.live ? await forward("judge", body) : reply({ verdict: "fail", evidence: "右の正方形が青く、黄色が見えない。" });
      }
      return new Response("not found", { status: 404 });
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  },
});

try {
  const model = { model: "gpt-6-luna", reasoningEffort: "low", maxCompletionTokens: 4096, timeoutMs: 80_000, store: false };
  const vision = { ...model, baseUrl: gateway.url + "vision" };
  const cfg = {
    hostPort: 4300, previewPort: 4301, dataDir: null, runTimeoutMs: 95_000, singleUser: true, datasets: [],
    model: { ...model, baseUrl: gateway.url + "maker", provider: "openai-compatible", label: "Visual repair" },
    review: { mode: "judge" },
    evaluator: { ...vision, provider: "openai-compatible", label: "Extra judge" },
  };
  const canvasConfig = join(tmp, "canvas.json");
  const visionConfig = join(tmp, "vision.json");
  await writeFile(canvasConfig, JSON.stringify(cfg));
  await writeFile(visionConfig, JSON.stringify(vision));
  const proc = Bun.spawn([
    process.execPath, join(import.meta.dir, "run.ts"), "--canvas-config", canvasConfig, "--vision-config", visionConfig,
    "--request", request, "--verify", condition, "--repair", "--key", "Space", "--out", out,
  ], { cwd: root, stdout: "inherit", stderr: "inherit" });
  const exit = await proc.exited;
  if (values.live && providerCalls.length)
    await writeFile(join(out, "provider-calls.json"), JSON.stringify(providerCalls, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  assert.equal(exit, 0, "Interact の修正ループを完了");
  const report = JSON.parse(await readFile(join(out, "report.json"), "utf8"));
  assert.equal(makerCalls, 2);
  assert.equal(judgeCalls, 1);
  assert.equal(report.independentJudgments, 1);
  assert.equal(report.verification.verdict, "fail");
  assert.deepEqual(report.replay.keys, ["Space"]);
  assert.equal(report.repair.status, "replayed");
  assert.equal(report.repair.error, null);
  assert.equal(report.repair.samePixels, false);
  const before = await readFile(join(out, report.capture.fileName));
  assert.deepEqual(judgedImage, before, "実際に保存した画像だけを判定に使用");
  const after = PNG.sync.read(await readFile(join(out, report.repair.capture.fileName)));
  assert.ok(countColor(after, "right", [255, 255, 0]) >= 1000, "同じSpace操作のあとに黄色い正方形を確認");
  assert.equal(countColor(after, "left", [0, 0, 255]), 0);
  if (values.live) assert.deepEqual(providerCalls, [
    { purpose: "judge", status: 200, model: "gpt-6-luna" },
    { purpose: "repair", status: 200, model: "gpt-6-luna" },
  ]);
  console.log(`修正前は右に青、修正後は右に黄。独立判定 ${judgeCalls} 回。 ${out}`);
} finally {
  gateway.stop(true);
  await rm(tmp, { recursive: true, force: true });
}
