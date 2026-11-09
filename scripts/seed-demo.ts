// デモの 4 題を、動いている検証ホストへ通常の API（/api/runs → 検査・観測 → 保存）で依頼して保存する。
// 使い方: bun scripts/seed-demo.ts [設定ファイル] [--owner <canvas_owner の値>] [--host <http://localhost:4300>]
// 同じ題名の作品がすでにある依頼は飛ばす（再実行しても重複しない）。
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DEMO = join(ROOT, "fixtures/demo/recordings.json");

function parseArgs(argv: string[]) {
  const o: { config: string; owner: string | null; host: string | null } = { config: join(ROOT, "canvas.config.json"), owner: null, host: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--owner") o.owner = argv[++i] ?? null;
    else if (a === "--host") o.host = argv[++i] ?? null;
    else if (!a.startsWith("--")) o.config = resolve(a);
    else throw new Error(`不明な引数: ${a}`);
  }
  return o;
}

const rid = () => randomBytes(12).toString("base64url");

export async function seedDemo(opts: { host: string; owner?: string | null; log?: (s: string) => void }) {
  const log = opts.log ?? console.log;
  const H = opts.host.replace(/\/$/, "");
  let owner = opts.owner ?? null;
  if (!owner) {
    const r = await fetch(H + "/");
    const m = (r.headers.get("set-cookie") ?? "").match(/canvas_owner=([A-Za-z0-9_-]+)/);
    if (!m) throw new Error("所有者 cookie を受け取れない");
    owner = m[1];
    log(`新しい所有者で入れます（canvas_owner=${owner}）。このブラウザで見るには、この値を cookie に設定するか --owner に自分の値を渡してください。`);
  }
  const call = async (path: string, init: { method?: string; body?: unknown; session?: string } = {}) => {
    const r = await fetch(H + path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", origin: H, cookie: `canvas_owner=${owner}`, "x-canvas-session": init.session ?? "seed-demo-0" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${r.status} ${j.error ?? ""}`);
    return j;
  };

  const demo = JSON.parse(readFileSync(DEMO, "utf8")) as { recordings: { input: { request: string }; output: { title: string } }[] };
  const existing = new Set(((await call("/api/artworks")) as { title: string }[]).map((a) => a.title));
  const results: { request: string; title: string; result: string; attempts?: number; artworkId?: string; checks?: string }[] = [];
  for (const rec of demo.recordings) {
    const { request } = rec.input;
    const { title } = rec.output;
    if (existing.has(title)) {
      log(`飛ばす: ${title}（同じ題名の作品がある）`);
      results.push({ request, title, result: "skipped" });
      continue;
    }
    const session = "seed-" + rid(); // 依頼ごとに別の制作画面として扱う（前の候補を置き換えない）
    const run = await call("/api/runs", { method: "POST", body: { message: request, artworkId: null, conversation: [] }, session });
    let r = run;
    const t0 = Date.now();
    while (r.state === "running") {
      if (Date.now() - t0 > 240_000) throw new Error(`${title}: 240 秒以内に終わらない`);
      await new Promise((res) => setTimeout(res, 300));
      r = await call(`/api/runs/${run.id}`, { session });
    }
    if (r.state !== "presented") {
      log(`失敗: ${title} → ${r.state}${r.failure ? ` (${r.failure})` : ""}`);
      results.push({ request, title, result: r.state, attempts: r.attempts });
      continue;
    }
    const c = r.candidates.find((x: any) => x.id === r.presentedCandidateId);
    const checks = (c.verification?.checks ?? []).map((k: any) => `${k.level}:${k.id}=${k.pass ? "合格" : "不合格"}`).join(" ");
    if (!c.verification?.requiredPassed) {
      log(`保存しない: ${title}（必須検査が不合格: ${checks}）`);
      results.push({ request, title, result: "required-failed", attempts: r.attempts, checks });
      continue;
    }
    const saved = await call(`/api/candidates/${c.id}/save`, { method: "POST", body: { expectedRevision: r.baseRevision, idempotencyKey: rid() }, session });
    log(`保存: ${title}（r${saved.revision}、試行 ${r.attempts}、${checks}）`);
    results.push({ request, title, result: "saved", attempts: r.attempts, artworkId: saved.artworkId, checks });
  }
  return { owner, results };
}

if (import.meta.main) {
  const a = parseArgs(process.argv.slice(2));
  const cfg = JSON.parse(readFileSync(a.config, "utf8")) as { hostPort: number };
  const host = a.host ?? `http://localhost:${cfg.hostPort}`;
  const out = await seedDemo({ host, owner: a.owner });
  const bad = out.results.filter((r) => r.result !== "saved" && r.result !== "skipped");
  process.exit(bad.length ? 1 : 0);
}
