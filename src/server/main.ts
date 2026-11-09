// 検証ホストの起動。設定ファイル（既定 canvas.config.json）からモデル提供者・データ・ポートを読む。
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../core/store";
import { CanvasService, type Dataset } from "../core/service";
import { PlaywrightObserver } from "../core/observer";
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
  model: { provider: "recorded"; label: string; files: string[]; ignoreLatency?: boolean; deliverAfterAbort?: boolean };
  datasets: { ref: string; description: string; file: string }[];
}

export function makeModel(cfg: CanvasConfig["model"], root: string): ModelPort {
  if (cfg.provider === "recorded") {
    const p = new RecordedProvider(cfg.files.map((f) => join(root, f)), cfg.label);
    p.ignoreLatency = !!cfg.ignoreLatency;
    p.deliverAfterAbort = !!cfg.deliverAfterAbort;
    return p;
  }
  throw new Error(`未対応のモデル提供者: ${(cfg as { provider: string }).provider}`);
}

export function loadDatasets(cfg: CanvasConfig, root: string): Dataset[] {
  return cfg.datasets.map((d) => ({ ref: d.ref, description: d.description, data: JSON.parse(readFileSync(join(root, d.file), "utf8")) }));
}

export function runFromConfig(cfg: CanvasConfig, root: string) {
  const contract = readFileSync(join(root, "docs/artwork-contract-v1.md"), "utf8");
  const app = startCanvasApp({
    hostPort: cfg.hostPort,
    previewPort: cfg.previewPort,
    devHarness: cfg.devHarness,
    logDir: cfg.logDir ? resolve(root, cfg.logDir) : cfg.dataDir ? resolve(root, cfg.dataDir, "logs") : null,
    makeService: ({ tokens, hostOrigin }) =>
      new CanvasService({
        store: new Store(cfg.dataDir ? resolve(root, cfg.dataDir) : null),
        model: makeModel(cfg.model, root),
        observer: new PlaywrightObserver(hostOrigin, (b) => tokens.issue(b)),
        contract,
        datasets: loadDatasets(cfg, root),
        runTimeoutMs: cfg.runTimeoutMs,
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
  console.log(app.logDir ? `診断ログ ${app.logDir}/server.log・client.log` : "診断ログ なし（dataDir・logDir が未設定）");
}
