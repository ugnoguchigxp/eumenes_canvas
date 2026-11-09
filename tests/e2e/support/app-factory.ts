import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { runFromConfig } from "../../../src/server/main";
import { e2eDataDir } from "./paths";

const ROOT = resolve(import.meta.dir, "../../..");

export function createTestApp(o: { hostPort: number; previewPort: number }) {
  // 試験からログを読めるよう、ポートで決まる場所に置く（起動時に空にし、終了時に消す）
  const dataDir = e2eDataDir(o.hostPort);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const cleanup = () => rmSync(dataDir, { recursive: true, force: true });
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));
  return runFromConfig(
    {
      hostPort: o.hostPort,
      previewPort: o.previewPort,
      dataDir,
      devHarness: true,
      runTimeoutMs: 180_000,
      model: { provider: "recorded", label: "p1-fixtures", files: ["fixtures/p1/recordings.json"] },
      datasets: [{ ref: "synthetic-sales", description: "合成売上", file: "fixtures/data/synthetic-sales.json" }],
    },
    ROOT,
  );
}
