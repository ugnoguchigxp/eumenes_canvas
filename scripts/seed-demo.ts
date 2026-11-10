// デモ（ゲーム 4 題と描画 5 題）を、動いている検証ホストへ通常の API（/api/runs → 検査・観測 → 保存）で依頼して保存する。
// 使い方: bun scripts/seed-demo.ts [設定ファイル] [--host <http://localhost:4300>]
// 同じ題名の作品がすでにある依頼は飛ばす（再実行しても重複しない）。
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DEMO = join(ROOT, "fixtures/demo/recordings.json");

function parseArgs(argv: string[]) {
  const o: { config: string; host: string | null } = { config: join(ROOT, "canvas.config.json"), host: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") o.host = argv[++i] ?? null;
    else if (!a.startsWith("--")) o.config = resolve(a);
    else throw new Error(`不明な引数: ${a}`);
  }
  return o;
}

const rid = () => randomBytes(12).toString("base64url");

export async function seedDemo(opts: { host: string; log?: (s: string) => void; titles?: string[] }) {
  const log = opts.log ?? console.log;
  const H = opts.host.replace(/\/$/, "");
  // 単一利用者モード（既定）では cookie は発行されず、保存した作品は全ブラウザの一覧に出る。
  // 所有者を分けるモードのホストなら、ここで受け取った新しい所有者に入る（他のブラウザには出ない）。
  const page = await fetch(H + "/");
  const m = (page.headers.get("set-cookie") ?? "").match(/canvas_owner=([A-Za-z0-9_-]+)/);
  const owner = m ? m[1] : null;
  if (owner) log("注意: このホストは所有者ごとに作品を分ける設定（singleUser: false）なので、入れた作品は他のブラウザの一覧には出ません。");
  const call = async (path: string, init: { method?: string; body?: unknown; session?: string } = {}) => {
    const r = await fetch(H + path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", origin: H, ...(owner ? { cookie: `canvas_owner=${owner}` } : {}), "x-canvas-session": init.session ?? "seed-demo-0" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${r.status} ${j.error ?? ""}`);
    return j;
  };

  const demo = JSON.parse(readFileSync(DEMO, "utf8")) as { recordings: { input: { request: string }; output: { title: string } }[] };
  const existing = new Set(((await call("/api/artworks")) as { title: string }[]).map((a) => a.title));
  const results: { request: string; title: string; result: string; attempts?: number; artworkId?: string; checks?: string }[] = [];
  const only = opts.titles ? new Set(opts.titles) : null;
  for (const rec of demo.recordings) {
    const { request } = rec.input;
    const { title } = rec.output;
    if (only && !only.has(title)) continue;
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
  const out = await seedDemo({ host });
  const bad = out.results.filter((r) => r.result !== "saved" && r.result !== "skipped");
  process.exit(bad.length ? 1 : 0);
}
