// 同じ作業コピーで全体試験と展開試験を通した配布候補を出力する。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { offline: { type: "boolean" } } });
assert(positionals.length <= 1, "使い方: bun run release:prepare [--offline] [出力先]");
const root = resolve(import.meta.dir, "..");
const out = resolve(positionals[0] ?? join(root, "eval/out/dist"));
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]
  .map((name) => [name, process.env[name]]));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
const bun = (cwd: string, ...args: string[]) => execFileSync(process.execPath, args, { cwd, env, stdio: "inherit" });
const tmp = mkdtempSync(join(tmpdir(), "canvas-release-"));
const snapshot = join(tmp, "source");

try {
  const commit = git(root, "rev-parse", "HEAD").trim();
  const inputs = new Set(git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean));
  git(root, "clone", "--local", "--no-hardlinks", "--no-checkout", "--quiet", ".", snapshot);
  git(snapshot, "update-ref", "--no-deref", "HEAD", commit);
  git(snapshot, "read-tree", commit);
  for (const path of inputs) {
    const from = join(root, path);
    if (!existsSync(from)) continue; // 削除済みのファイルは作業コピーにも置かない
    const to = join(snapshot, path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { verbatimSymlinks: true });
  }
  const offline = values.offline ? ["--offline"] : [];
  bun(snapshot, "install", "--frozen-lockfile", "--ignore-scripts", ...offline);
  bun(snapshot, "run", "verify");
  bun(snapshot, "run", "p3:typecheck");
  bun(snapshot, "scripts/verify-canvas-package.ts", ...offline, "--out-dir", out);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
