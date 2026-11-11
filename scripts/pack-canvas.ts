// Eumenes 取込前の候補。コア・プレビュー・公開契約だけを別環境で検証できる形にする。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Bun が生成した USTAR の通常ファイルだけを扱い、記録時刻を固定する。 */
function fixArchiveTimestamps(tar: Buffer) {
  const blockSize = 512;
  for (let offset = 0; offset < tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + blockSize);
    if (header.length !== blockSize || header.toString("ascii", 257, 263) !== "ustar\u0000" || header[156] !== 48) {
      throw new Error("配布物に USTAR の通常ファイル以外が含まれる");
    }
    const sizeText = header.toString("ascii", 124, 136).replace(/[\u0000 ]+$/, "");
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("配布物のファイル長が不正");
    const size = Number.parseInt(sizeText, 8);
    const next = offset + blockSize * (1 + Math.ceil(size / blockSize));
    if (next > tar.length) throw new Error("配布物のファイル内容が途中で終わった");
    header.write("00000000000\u0000", 136, "ascii");
    header.fill(32, 148, 156); // USTAR のチェックサムを計算するときはこの領域を空白として扱う。
    const sum = header.reduce((total, byte) => total + byte, 0).toString(8).padStart(6, "0");
    header.write(sum + "\u0000 ", 148, "ascii");
    offset = next;
  }
}

const contracts = ["docs/artwork-contract-v1.md", "docs/artwork-contract-v2-page.md"];
const paths = git("ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
  "src/contract", "src/core", "src/preview", "src/shared",
  "src/server/preview.ts", "src/server/instrument-loops.ts", "src/host/preview-client.js",
  "src/host/harness.html", "src/host/harness.js", "src/host/harness.css",
  ...contracts, "docs/maker-skill.md", "docs/maker-pitfalls.md", "docs/evaluator-skill.md",
).split("\0").filter(Boolean).sort();
const files: Record<string, Buffer | string> = {};
for (const path of paths) files[path] = readFileSync(join(root, path));

const sourcePackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { name, version, packageManager } = sourcePackage;
const dependencies = {
  ...sourcePackage.dependencies,
  "@playwright/test": sourcePackage.devDependencies["@playwright/test"],
  pngjs: sourcePackage.devDependencies.pngjs,
};
files["package.json"] = JSON.stringify({
  name, version, private: true, type: "module", packageManager,
  dependencies,
}, null, 2) + "\n";
// 依存の解決・整合性情報はソースの lock から引き継ぎ、配布先の直接依存だけを置き換える。
const lock = Bun.JSONC.parse(readFileSync(join(root, "bun.lock"), "utf8")) as Record<string, unknown>;
files["bun.lock"] = JSON.stringify({ ...lock, workspaces: { "": { name, dependencies } } }, null, 2) + "\n";
const hashes = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256(bytes)]));
const sourceCommit = git("rev-parse", "HEAD").trim();
const workingTreeChanges = git("status", "--porcelain", "--", ...paths, "package.json", "bun.lock").length > 0;
files["canvas-package.json"] = JSON.stringify({
  name, version, sourceCommit, workingTreeChanges,
  contracts: { "canvas-artwork/1": contracts[0], "canvas-artwork/2": contracts[1] },
  sha256: hashes,
}, null, 2) + "\n";

const dir = resolve(process.argv[2] ?? join(root, "eval/out/dist"));
mkdirSync(dir, { recursive: true });
const tar = Buffer.from(await new Bun.Archive(files).bytes());
fixArchiveTimestamps(tar);
const compressed = Buffer.from(Bun.gzipSync(tar));
const digest = sha256(compressed);
const file = `${name}-${version}-${digest.slice(0, 12)}.tgz`;
const path = join(dir, file);
writeFileSync(path, compressed);
writeFileSync(path + ".sha256", `${digest}  ${file}\n`);
console.log(path, digest);
