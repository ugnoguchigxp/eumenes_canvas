// 試験プロセスと起動スクリプトの両方から使う置き場所（Bun 専用の依存を持たない）。
import { tmpdir } from "node:os";
import { join } from "node:path";

/** E2E のデータ置き場。ポートで決まり、試験からログを読める。 */
export const e2eDataDir = (hostPort: number) => join(tmpdir(), `canvas-e2e-${hostPort}`);
