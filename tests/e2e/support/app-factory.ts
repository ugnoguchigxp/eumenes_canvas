import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runFromConfig } from "../../../src/server/main";

const ROOT = resolve(import.meta.dir, "../../..");

export function createTestApp(o: { hostPort: number; previewPort: number }) {
  const dataDir = mkdtempSync(join(tmpdir(), "canvas-e2e-"));
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
