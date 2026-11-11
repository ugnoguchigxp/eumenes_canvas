// 検証ホストの起動。設定ファイル（既定 canvas.config.json）からモデル提供者・データ・ポートを読む。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../core/store";
import { CanvasService, type Dataset } from "../core/service";
import { HostReviewer } from "../core/host-reviewer";
import { PlaywrightObserver } from "../core/observer";
import { PlaywrightProber } from "../core/probes";
import { PromptEvaluator } from "../core/prompt-evaluator";
import { PromptMaker } from "../core/prompt-maker";
import type { ReviewMode } from "../core/review";
import { HttpChannel, type HttpChannelOptions } from "./http-channel";
import { RecordedProvider } from "../core/recorded-provider";
import type { ModelPort } from "../core/model-port";
import { startCanvasApp } from "./canvas-app";

export interface CanvasConfig {
  hostPort: number;
  previewPort: number;
  dataDir: string | null;
  /** 診断ログの置き場所。既定は <dataDir>/logs。 */
  logDir?: string | null;
  runTimeoutMs?: number;
  devHarness?: boolean;
  /** 単一利用者モード（作品一覧をブラウザ間で共有）。項目が無ければ真。 */
  singleUser?: boolean;
  /** 直接描画（実時間の表示で画面の canvas を作品 Worker に渡す。Chromium 系だけ）。項目が無ければ偽。 */
  directRender?: boolean;
  /**
   * ページ直接モード（design.md §8。作品を DOM のある文書で動かす。Chromium だけ）。項目が無ければ偽。
   * 利用者が残る危険（WebRTC の外部通信、WebKit の wasm、WebKit でのホストの固まり）を受け入れたときだけ真にする。
   */
  pageMode?: boolean;
  /** 観測のブラウザ（Chromium）に足す起動引数。既定は空。 */
  observerArgs?: string[];
  /** 候補の検証。省略時は off。 */
  review?: { mode: "off" | "probes" | "judge" | "full"; maxReviews?: number };
  /** 制作担当。モデルの名前は設定にだけ書く（製品のコード・ファイル名に書かない）。 */
  model:
    | { provider: "recorded"; label: string; files: string[]; ignoreLatency?: boolean; deliverAfterAbort?: boolean }
    | ({ provider: "openai-compatible"; label: string } & HttpChannelOptions);
  /** 検証担当。省略時は検証担当なし（review.mode が judge・full でも観測だけになる）。 */
  evaluator?: { provider: "openai-compatible"; label: string } & HttpChannelOptions;
  datasets: { ref: string; description: string; file: string }[];
}

// ignoreLatency は記録済み推論だけが使う（scripts/seed-demo.ts はどの設定にも付けて渡す）
export function makeModel(cfg: CanvasConfig["model"] & { ignoreLatency?: boolean }, root: string): ModelPort {
  if (cfg.provider === "recorded") {
    const p = new RecordedProvider(cfg.files.map((f) => join(root, f)), cfg.label);
    p.ignoreLatency = !!cfg.ignoreLatency;
    p.deliverAfterAbort = !!cfg.deliverAfterAbort;
    return p;
  }
  if (cfg.provider === "openai-compatible") {
    const { provider: _p, label, ignoreLatency: _i, ...http } = cfg;
    return new PromptMaker(new HttpChannel(http), { label });
  }
  throw new Error(`未対応のモデル提供者: ${(cfg as { provider: string }).provider}`);
}

export function loadDatasets(cfg: CanvasConfig, root: string): Dataset[] {
  return cfg.datasets.map((d) => ({ ref: d.ref, description: d.description, data: JSON.parse(readFileSync(join(root, d.file), "utf8")) }));
}

/** 設定から検証担当を作る。無ければ null。 */
export function makeEvaluator(cfg: CanvasConfig["evaluator"]): PromptEvaluator | null {
  if (!cfg) return null;
  if (cfg.provider !== "openai-compatible") throw new Error(`未対応の検証担当の提供者: ${(cfg as { provider: string }).provider}`);
  const { provider: _p, label, ...http } = cfg;
  return new PromptEvaluator(new HttpChannel(http), { label });
}

/** 設定から検証を組み立てる。無い・off なら undefined（今と同じ動作）。検証担当は設定 evaluator から（無ければ観測だけ）。 */
export function makeReview(cfg: Pick<CanvasConfig, "review" | "observerArgs" | "evaluator">, hostOrigin: string, issue: (b: Parameters<PlaywrightProber["probe"]>[0]) => string) {
  if (!cfg.review || cfg.review.mode === "off") return undefined;
  const reviewer = new HostReviewer(new PlaywrightProber(hostOrigin, issue, cfg.observerArgs ?? []), makeEvaluator(cfg.evaluator));
  return { reviewer, mode: cfg.review.mode as ReviewMode, maxReviews: cfg.review.maxReviews };
}

export const singleUserOf = (cfg: Pick<CanvasConfig, "singleUser">) => cfg.singleUser !== false;

/**
 * 観測・検証のブラウザの起動引数。ページ直接モードが有効なときだけ --site-per-process を足す
 * （既定の headless shell では別サイトの iframe が同じプロセスに入り、作品の無限ループで観測のホストごと固まる。10 の測定 H1・H2）。
 */
export function browserArgsOf(cfg: Pick<CanvasConfig, "observerArgs" | "pageMode">): string[] {
  const a = [...(cfg.observerArgs ?? [])];
  if (cfg.pageMode === true && !a.includes("--site-per-process")) a.push("--site-per-process");
  return a;
}

export function runFromConfig(cfg: CanvasConfig, root: string) {
  const singleUser = singleUserOf(cfg);
  const browserArgs = browserArgsOf(cfg);
  const contract = readFileSync(join(root, "docs/artwork-contract-v1.md"), "utf8");
  const app = startCanvasApp({
    hostPort: cfg.hostPort,
    previewPort: cfg.previewPort,
    devHarness: cfg.devHarness,
    directRender: cfg.directRender,
    pageMode: cfg.pageMode === true,
    singleUser,
    logDir: cfg.logDir ? resolve(root, cfg.logDir) : cfg.dataDir ? resolve(root, cfg.dataDir, "logs") : null,
    makeService: ({ tokens, hostOrigin, singleUser }) =>
      new CanvasService({
        store: new Store(cfg.dataDir ? resolve(root, cfg.dataDir) : null),
        model: makeModel(cfg.model, root),
        observer: new PlaywrightObserver(hostOrigin, (b) => tokens.issue(b), browserArgs),
        contract,
        datasets: loadDatasets(cfg, root),
        runTimeoutMs: cfg.runTimeoutMs,
        singleUser,
        pageMode: cfg.pageMode === true,
        review: makeReview({ ...cfg, observerArgs: browserArgs }, hostOrigin, (b) => tokens.issue(b)),
      }),
  });
  return app;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "../..");
  const file = process.argv[2] ?? join(root, "canvas.config.json");
  const cfg = JSON.parse(readFileSync(file, "utf8")) as CanvasConfig;
  const app = runFromConfig(cfg, root);
  console.log(`検証ホスト ${app.hostOrigin}（プレビュー ${app.previewOrigin}）`);
  console.log(singleUserOf(cfg) ? "単一利用者モード（全ブラウザで作品一覧を共有）" : "所有者ごとに作品を分けるモード");
  console.log(app.logDir ? `診断ログ ${app.logDir}/server.log・client.log` : "診断ログ なし（dataDir・logDir が未設定）");
}
