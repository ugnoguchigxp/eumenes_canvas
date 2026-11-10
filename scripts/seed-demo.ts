// デモ（ゲーム 4 題と描画 5 題）を、通常の経路（記録済み推論 → 契約検査 → プレビュー観測 → 必須検査 → Store の保存）で dataDir に入れる。
// 使い方: bun scripts/seed-demo.ts [設定ファイル]
// 検証ホストは止めたままでよい（動いていれば書き込まずに止まる。同じ dataDir に二つの書き込み手を付けない）。
// 観測用の一時ホストはループバックの空きポートで実行の間だけ立て、終われば Chromium と待ち受けを閉じる。
// 題名ごとに：無ければ新しい作品（r1）、保存版が今の固定応答と同じなら飛ばす、違えば同じ作品の新しい版（r1→r2）。
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { artworkDigest, type ArtworkBody } from "../src/contract/artwork";
import type { GenerationInput, GenerationOutput, ModelPort } from "../src/core/model-port";
import { PlaywrightObserver, type ObserverPort } from "../src/core/observer";
import type { RecordingFile } from "../src/core/recorded-provider";
import { CanvasService } from "../src/core/service";
import { Store } from "../src/core/store";
import { startCanvasApp } from "../src/server/canvas-app";
import { loadDatasets, makeModel, singleUserOf, type CanvasConfig } from "../src/server/main";

const ROOT = resolve(import.meta.dir, "..");
export const DEMO = join(ROOT, "fixtures/demo/recordings.json");
/** 既定の設定のポート。設定が別のポートでも、一時ホストはこれらを使わない。 */
const RESERVED_PORTS = [4300, 4301];

const rid = () => randomBytes(12).toString("base64url");

export type SeedResult = {
  request: string;
  title: string;
  /** saved（新しい作品）・updated（同じ作品の新しい版）・skipped（同じ版がある）・それ以外は失敗 */
  result: "saved" | "updated" | "skipped" | string;
  revision?: number;
  fromRevision?: number;
  attempts?: number;
  artworkId?: string;
  checks?: string;
};

/** 固定応答が返す作品の本体（RecordedProvider と同じ組み立て）。 */
export function demoBodies(file = DEMO): { request: string; body: ArtworkBody }[] {
  const j = JSON.parse(readFileSync(file, "utf8")) as RecordingFile;
  const dir = dirname(file);
  return j.recordings.map((rec) => {
    const o = rec.output;
    const body: ArtworkBody = { title: o.title, entry: readFileSync(join(dir, o.entryFile), "utf8"), ...(o.dataRef ? { dataRef: o.dataRef } : {}), ...(o.libraries?.length ? { libraries: o.libraries } : {}) };
    return { request: rec.input.request, body };
  });
}

/**
 * 投入スクリプト専用の制作担当。デモの固定応答は会話なし・基準なしで記録した全体の作品なので、
 * 既存の作品を新しい版にするときも、記録を引く鍵から基準（base・baseDigest）を外して同じ記録を引く。
 * 出力・検査・観測・保存の判定は変えない。通常のホストでは使わない。
 */
export class DemoReplaceModel implements ModelPort {
  readonly label: string;
  constructor(private inner: ModelPort) {
    this.label = inner.label + "+demo-replace";
  }
  generate(input: GenerationInput, signal: AbortSignal): Promise<GenerationOutput> {
    return this.inner.generate({ ...input, base: null, baseDigest: null }, signal);
  }
}

/**
 * 動いている検証ホスト（host）へ通常の API で依頼する。コマンドからは一時ホストに対してだけ使う（試験でも使う）。
 * 既存の作品を新しい版にするには、そのホストの制作担当が DemoReplaceModel である必要がある。
 */
export async function seedDemo(opts: { host: string; log?: (s: string) => void; titles?: string[]; recordings?: string }) {
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

  const list = (await call("/api/artworks")) as { id: string; title: string; currentRevision: number; updatedAt: number }[]; // 新しい順
  const results: SeedResult[] = [];
  const only = opts.titles ? new Set(opts.titles) : null;
  for (const { request, body } of demoBodies(opts.recordings)) {
    const { title } = body;
    if (only && !only.has(title)) continue;
    const same = list.filter((a) => a.title === title);
    let target: { id: string; revision: number } | null = null;
    if (same.length) {
      const a = same[0];
      if (same.length > 1) log(`注意: 「${title}」という作品が ${same.length} 件ある。最も新しく更新した ${a.id} を対象にする`);
      const detail = await call(`/api/artworks/${a.id}`);
      const cur = (detail.revisions as { revision: number; digest: string }[]).find((r) => r.revision === detail.currentRevision);
      const want = await artworkDigest(body);
      if (cur?.digest === want) {
        log(`飛ばす: ${title}（r${detail.currentRevision} が今の版と同じ）`);
        results.push({ request, title, result: "skipped", revision: detail.currentRevision, artworkId: a.id });
        continue;
      }
      target = { id: a.id, revision: detail.currentRevision };
    }
    const session = "seed-" + rid(); // 依頼ごとに別の制作画面として扱う（前の候補を置き換えない）
    const run = await call("/api/runs", { method: "POST", body: { message: request, artworkId: target?.id ?? null, conversation: [] }, session });
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
    // 通常の保存：現在版の照合（expectedRevision）と受領キー。基準にした版から変わっていれば 409 で失敗する
    const saved = await call(`/api/candidates/${c.id}/save`, { method: "POST", body: { expectedRevision: r.baseRevision, idempotencyKey: rid() }, session });
    if (target) {
      log(`更新: ${title}（r${target.revision} → r${saved.revision}、試行 ${r.attempts}、${checks}）`);
      results.push({ request, title, result: "updated", revision: saved.revision, fromRevision: target.revision, attempts: r.attempts, artworkId: saved.artworkId, checks });
    } else {
      log(`保存: ${title}（r${saved.revision}、試行 ${r.attempts}、${checks}）`);
      results.push({ request, title, result: "saved", revision: saved.revision, attempts: r.attempts, artworkId: saved.artworkId, checks });
    }
  }
  return { owner, results };
}

// ---- 待ち受けの確認と一時ポート ----

/** ループバック（127.0.0.1 または ::1）でそのポートが接続を受けているか。 */
export async function isPortListening(port: number, timeoutMs = 400): Promise<boolean> {
  for (const hostname of ["127.0.0.1", "::1"]) if (await isPortOpen(port, hostname, timeoutMs)) return true;
  return false;
}

async function isPortOpen(port: number, hostname: string, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sock = await Promise.race([
      Bun.connect({ hostname, port, socket: { data() {}, error() {} } }),
      new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("timeout")), timeoutMs))),
    ]);
    sock.end();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** そのポートで待ち受けているプロセスの PID（lsof か ss で分かるときだけ）。 */
export function listenerPids(port: number): number[] {
  const tries: string[][] = [
    ["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
    ["ss", "-ltnpH", `sport = :${port}`],
  ];
  for (const cmd of tries) {
    try {
      const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore" });
      const out = p.stdout.toString();
      const pids = cmd[0] === "lsof" ? out.split(/\s+/).filter(Boolean).map(Number) : [...out.matchAll(/pid=(\d+)/g)].map((x) => Number(x[1]));
      const uniq = [...new Set(pids.filter((n) => Number.isInteger(n) && n > 0))];
      if (uniq.length) return uniq;
    } catch {
      /* コマンドが無い */
    }
  }
  return [];
}

/** 127.0.0.1 と ::1 の両方で空いているポートを一つ返す（exclude は使わない）。 */
export async function reserveLoopbackPort(exclude: Iterable<number> = []): Promise<number> {
  const ban = new Set([...exclude, ...RESERVED_PORTS]);
  for (let i = 0; i < 30; i++) {
    const a = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const p = a.port ?? 0;
    let ok = false;
    try {
      Bun.serve({ port: p, hostname: "::1", fetch: () => new Response("") }).stop(true);
      ok = true;
    } catch {
      /* ::1 側が使用中 */
    }
    a.stop(true);
    if (ok && p && !ban.has(p)) return p;
  }
  throw new Error("空きのループバックポートがない");
}

export class SeedRefused extends Error {}

/** 検証ホストが動いていれば、書き込まずに止める理由（日本語）を返す。動いていなければ null。 */
export async function runningHostMessage(cfg: Pick<CanvasConfig, "hostPort" | "previewPort" | "dataDir">, root = ROOT): Promise<string | null> {
  for (const port of [cfg.hostPort, cfg.previewPort]) {
    if (!(await isPortListening(port))) continue;
    const pids = listenerPids(port);
    const who = pids.length ? `PID ${pids.join(", ")}` : "PID は取得できませんでした";
    const data = cfg.dataDir ? resolve(root, cfg.dataDir) : "（dataDir なし）";
    return [
      `検証ホストが動いています（ポート ${port}、${who}）。`,
      `同じ保存先（${data}）に二つの書き込み手を付けないため、何も書き込まずに終了します。`,
      `ホストを止めてから（起動したターミナルで Ctrl+C${pids.length ? `、または kill ${pids.join(" ")}` : ""}）、もう一度 bun scripts/seed-demo.ts を実行してください。`,
    ].join("\n");
  }
  return null;
}

/**
 * サーバーなしで投入する。設定のポートが待ち受けていれば SeedRefused。
 * 観測用の一時ホストを空きのループバックポートで立て、同じ CanvasService・Store（設定の dataDir）で投入し、すべて閉じる。
 */
export async function seedDemoOffline(opts: { config: CanvasConfig; root?: string; log?: (s: string) => void; titles?: string[]; observer?: ObserverPort }) {
  const log = opts.log ?? console.log;
  const root = opts.root ?? ROOT;
  const cfg = opts.config;
  const busy = await runningHostMessage(cfg, root);
  if (busy) throw new SeedRefused(busy);

  const avoid = new Set([cfg.hostPort, cfg.previewPort]);
  const hostPort = await reserveLoopbackPort(avoid);
  avoid.add(hostPort);
  const previewPort = await reserveLoopbackPort(avoid);
  const singleUser = singleUserOf(cfg);
  const contract = readFileSync(join(root, "docs/artwork-contract-v1.md"), "utf8");
  const dataDir = cfg.dataDir ? resolve(root, cfg.dataDir) : null;
  const app = startCanvasApp({
    hostPort,
    previewPort,
    devHarness: false,
    singleUser,
    logDir: cfg.logDir ? resolve(root, cfg.logDir) : dataDir ? join(dataDir, "logs") : null,
    makeService: ({ tokens, hostOrigin, singleUser }) =>
      new CanvasService({
        store: new Store(dataDir),
        model: new DemoReplaceModel(makeModel({ ...cfg.model, ignoreLatency: true }, root)),
        observer: opts.observer ?? new PlaywrightObserver(hostOrigin, (b) => tokens.issue(b)),
        contract,
        datasets: loadDatasets(cfg, root),
        runTimeoutMs: cfg.runTimeoutMs,
        singleUser,
      }),
  });
  log(`保存先 ${dataDir ? join(dataDir, "store.json") : "（メモリのみ）"}。観測用の一時ホスト ${app.hostOrigin}（プレビュー ${app.previewOrigin}）は終了時に止める`);
  try {
    const out = await seedDemo({ host: app.hostOrigin, log, titles: opts.titles });
    return { ...out, bound: { hostPort, previewPort } };
  } finally {
    try {
      await app.service.close();
    } catch (e) {
      console.error("観測器の停止に失敗", e);
    }
    app.stop();
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const bad = args.find((a) => a.startsWith("--"));
  if (bad) {
    console.error(`不明な引数: ${bad}（使い方: bun scripts/seed-demo.ts [設定ファイル]）`);
    process.exit(64);
  }
  const file = args[0] ? resolve(args[0]) : join(ROOT, "canvas.config.json");
  const cfg = JSON.parse(readFileSync(file, "utf8")) as CanvasConfig;
  const t0 = Date.now();
  let code = 0;
  try {
    const out = await seedDemoOffline({ config: cfg, root: ROOT });
    const n = (k: string) => out.results.filter((r) => r.result === k).length;
    const failed = out.results.filter((r) => !["saved", "updated", "skipped"].includes(r.result));
    console.log(`完了（${((Date.now() - t0) / 1000).toFixed(1)} 秒）: 新規 ${n("saved")}、新しい版 ${n("updated")}、飛ばす ${n("skipped")}、失敗 ${failed.length}`);
    code = failed.length ? 1 : 0;
  } catch (e) {
    if (e instanceof SeedRefused) {
      console.error(e.message);
      code = 2;
    } else {
      console.error(e);
      code = 1;
    }
  }
  process.exit(code);
}
