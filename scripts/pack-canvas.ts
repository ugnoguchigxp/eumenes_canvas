// Eumenes 取込前の候補。コア・プレビュー・公開契約だけを別環境で検証できる形にする。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
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
files["package.json"] = JSON.stringify({
  name, version, private: true, type: "module", packageManager,
  dependencies: {
    ...sourcePackage.dependencies,
    "@playwright/test": sourcePackage.devDependencies["@playwright/test"],
    pngjs: sourcePackage.devDependencies.pngjs,
  },
}, null, 2) + "\n";
const hashes = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, sha256(bytes)]));
const sourceCommit = git("rev-parse", "HEAD").trim();
const workingTreeChanges = git("status", "--porcelain", "--", ...paths, "package.json").length > 0;
files["canvas-package.json"] = JSON.stringify({
  name, version, sourceCommit, workingTreeChanges,
  contracts: { "canvas-artwork/1": contracts[0], "canvas-artwork/2": contracts[1] },
  sha256: hashes,
}, null, 2) + "\n";

const dir = resolve(process.argv[2] ?? join(root, "eval/out/dist"));
mkdirSync(dir, { recursive: true });
const file = `${name}-${version}-${sha256(files["canvas-package.json"]).slice(0, 12)}.tgz`;
const path = join(dir, file);
await Bun.Archive.write(path, files, { compress: "gzip" });
const digest = sha256(readFileSync(path));
writeFileSync(path + ".sha256", `${digest}  ${file}\n`);
console.log(path, digest);
