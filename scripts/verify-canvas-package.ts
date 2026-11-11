// 配布用のファイルと、展開先だけで動く制作経路を確認する。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { offline: { type: "boolean" }, "out-dir": { type: "string" } } });
assert(positionals.length <= 1, "使い方: bun run verify:package [--offline] [配布アーカイブ]");
assert(!values["out-dir"] || !positionals.length, "出力先は、アーカイブを新しく作成する場合に指定する");
const root = resolve(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "canvas-package-verify-"));
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]
  .map((name) => [name, process.env[name]]));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bun = (cwd: string, args: string[]) => execFileSync(process.execPath, args, { cwd, env, stdio: "inherit", timeout: 180_000 });

try {
  const archiveDir = join(tmp, "dist");
  let archivePath: string;
  if (positionals.length) archivePath = resolve(positionals[0]);
  else {
    bun(root, ["scripts/pack-canvas.ts", archiveDir]);
    const archiveName = readdirSync(archiveDir).find((name) => name.endsWith(".tgz"));
    assert(archiveName, "配布アーカイブを作成できなかった");
    archivePath = join(archiveDir, archiveName);
    // TAR の時刻は秒単位。別の秒で作り、ファイル名とバイト列を照合する。
    await Bun.sleep(1100);
    const repeatDir = join(tmp, "repeat");
    bun(root, ["scripts/pack-canvas.ts", repeatDir]);
    const repeated = Bun.file(join(repeatDir, archiveName));
    assert(await repeated.exists(), "同じ内容で配布アーカイブの名前が変わった");
    assert.equal(hash(await repeated.bytes()), hash(await Bun.file(archivePath).bytes()), "同じ内容で配布アーカイブのハッシュが変わった");
  }
  const archive = await Bun.file(archivePath).bytes();
  const digest = hash(archive);
  assert.equal((await Bun.file(archivePath + ".sha256").text()).trim(), `${digest}  ${basename(archivePath)}`, "アーカイブの照合に失敗");

  const files = await new Bun.Archive(archive).files();
  const manifestFile = files.get("canvas-package.json");
  assert(manifestFile, "配布物に canvas-package.json がない");
  const manifest = await manifestFile.json() as { sourceCommit: string; workingTreeChanges: boolean; contracts: Record<string, string>; sha256: Record<string, string> };
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(typeof manifest.workingTreeChanges, "boolean");
  for (const name of ["package.json", "bun.lock", manifest.contracts["canvas-artwork/1"], manifest.contracts["canvas-artwork/2"]]) {
    assert(name && Object.hasOwn(manifest.sha256, name), `配布物に必要なファイルがない: ${name}`);
  }
  assert.equal(files.size, Object.keys(manifest.sha256).length + 1, "同梱ファイルの件数が一致しない");
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    const file = files.get(name);
    assert(file && hash(await file.bytes()) === expected, `同梱ファイルの照合に失敗: ${name}`);
  }
  for (const name of files.keys()) {
    assert(!name.includes("\\") && name.split("/").every((part) => part && part !== "." && part !== ".."), `配布物のパスが不正: ${name}`);
  }

  const unpacked = join(tmp, "installed");
  for (const [name, file] of files) {
    const target = join(unpacked, name);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, file);
  }
  bun(unpacked, ["install", "--frozen-lockfile", "--ignore-scripts", ...(values.offline ? ["--offline"] : [])]);
  const smoke = "tests/package/smoke.ts";
  mkdirSync(join(unpacked, "tests/package"), { recursive: true });
  copyFileSync(join(root, smoke), join(unpacked, smoke));
  bun(unpacked, [smoke, join(root, "fixtures/p1/artworks/falling-block.js")]);
  console.log(`配布検証合格 ${files.size}ファイル、ソース ${manifest.sourceCommit}`);
  if (values["out-dir"]) {
    const out = resolve(values["out-dir"]);
    mkdirSync(out, { recursive: true });
    const staged = mkdtempSync(join(out, ".canvas-verified-"));
    try {
      for (const suffix of ["", ".sha256"]) copyFileSync(archivePath + suffix, join(staged, basename(archivePath) + suffix));
      for (const name of [basename(archivePath), basename(archivePath) + ".sha256"]) renameSync(join(staged, name), join(out, name));
    } finally {
      rmSync(staged, { recursive: true, force: true });
    }
    console.log(`検証済み配布候補 ${join(out, basename(archivePath))} ${digest}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
