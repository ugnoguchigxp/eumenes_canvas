// 描画方式の拡張（design.md §7）：同梱ライブラリの宣言・契約の検査・digest・Worker スクリプトの組み立て・SVG の通知の検査。
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { artworkDigest, checkArtwork } from "../../src/contract/artwork";
import { HOST_LIBRARIES, resolveLibraries } from "../../src/contract/libraries";
import { assembleWorkerScript, librarySource, loadLibraries, shellCsp, WORKER_CSP } from "../../src/server/preview";
import { startApp } from "../../src/server/app";
import { checkWorkerToShell, LIMITS } from "../../src/shared/messages.js";
import { ROOT } from "./support";

const entry = "canvasApp.start((api) => ({ frame() {} }));";
const three = `canvasApp.start((api) => { const s = new THREE.Scene(); return { frame() {} }; });`;

describe("同梱ライブラリの宣言", () => {
  test("登録表の版は package.json の exact 固定と一致し、契約の文書にも同じ id がある", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const contract = readFileSync(join(ROOT, "docs/artwork-contract-v1.md"), "utf8");
    for (const l of HOST_LIBRARIES) {
      expect(pkg.dependencies[l.pkg]).toBe(l.version);
      expect(l.id).toBe(`${l.pkg}@${l.version}`);
      expect(contract).toContain(`"${l.id}"`);
      expect(JSON.parse(readFileSync(join(ROOT, "node_modules", l.pkg, "package.json"), "utf8")).version).toBe(l.version);
    }
    expect(HOST_LIBRARIES.map((l) => l.id)).toEqual(["three@0.187.0", "cannon-es@0.20.0"]);
  });
  test("宣言した作品は通り、未宣言の THREE・CANNON、未提供の id、重複、配列でない値は拒否する", () => {
    expect(checkArtwork({ title: "t", entry: three, libraries: ["three@0.187.0"] }).ok).toBe(true);
    expect(checkArtwork({ title: "t", entry: three, libraries: ["three@0.187.0", "cannon-es@0.20.0"] }).ok).toBe(true);
    const undeclared = checkArtwork({ title: "t", entry: three });
    expect(undeclared.ok).toBe(false);
    expect(undeclared.errors.join()).toContain('"three@0.187.0"');
    expect(checkArtwork({ title: "t", entry: "canvasApp.start(() => { CANNON.World; return {}; });" }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry, libraries: ["three@0.160.0"] }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry, libraries: ["three"] }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry, libraries: ["three@0.187.0", "three@0.187.0"] }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry, libraries: "three@0.187.0" }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry, libraries: [1] }).ok).toBe(false);
  });
  test("作品が自分で宣言した同名の変数は未宣言の使用とみなさない。宣言したライブラリと同名の let・const は構文エラー", () => {
    expect(checkArtwork({ title: "t", entry: `const THREE = { x: 1 }; THREE.x; ${entry}` }).ok).toBe(true);
    const r = checkArtwork({ title: "t", entry: `const THREE = {}; ${entry}`, libraries: ["three@0.187.0"] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("構文エラー");
  });
  test("宣言の順によらず登録の順に並べる", () => {
    expect(resolveLibraries(["cannon-es@0.20.0", "three@0.187.0"]).map((l) => l.param)).toEqual(["THREE", "CANNON"]);
  });
  test("宣言しない作品の digest は従来の計算と同じ。宣言すると変わり、宣言の順には依らない", async () => {
    const old = new Bun.CryptoHasher("sha256").update(JSON.stringify({ contract: "canvas-artwork/1", title: "t", entry, dataRef: null })).digest("hex");
    expect(await artworkDigest({ title: "t", entry })).toBe("sha256:" + old);
    expect(await artworkDigest({ title: "t", entry, libraries: [] })).toBe("sha256:" + old);
    const a = await artworkDigest({ title: "t", entry, libraries: ["three@0.187.0", "cannon-es@0.20.0"] });
    expect(a).not.toBe("sha256:" + old);
    expect(await artworkDigest({ title: "t", entry, libraries: ["cannon-es@0.20.0", "three@0.187.0"] })).toBe(a);
  });
});

describe("Worker スクリプトの組み立て", () => {
  test("宣言しない作品は従来どおり（ライブラリを含まず、引数は canvasApp だけ）", () => {
    const s = assembleWorkerScript(entry);
    expect(s).toContain(";(function (canvasApp) {");
    expect(s).toContain("}).call(undefined, __canvasApp);");
    expect(s).not.toContain("（ホスト同梱）");
  });
  test("宣言したライブラリはブートストラップの後・作品の前に連結し、引数で渡す", async () => {
    const libs = await loadLibraries(["cannon-es@0.20.0", "three@0.187.0"]);
    const s = assembleWorkerScript(three, libs);
    const iBoot = s.indexOf("var __canvasLibs = {};"), iThree = s.indexOf("// three@0.187.0"), iCannon = s.indexOf("// cannon-es@0.20.0"), iEntry = s.indexOf(three);
    expect(iBoot).toBeGreaterThanOrEqual(0);
    expect(iBoot).toBeLessThan(iThree);
    expect(iThree).toBeLessThan(iCannon);
    expect(iCannon).toBeLessThan(iEntry);
    expect(s).toContain(';(function (canvasApp, THREE, CANNON) {');
    expect(s).toContain('}).call(undefined, __canvasApp, __canvasLibs["three"], __canvasLibs["cannon"]);');
  });
  test("束ねたライブラリは古典的スクリプト（IIFE）で、import・importScripts・WebAssembly を含まない。大きさを記録する", async () => {
    for (const l of HOST_LIBRARIES) {
      const src = await librarySource(l);
      expect(src.startsWith("(()=>{")).toBe(true);
      expect(src).not.toMatch(/\bimport\s*\(|\bimportScripts\b|WebAssembly|\bimport\s+[\w{*]/);
      expect(src).toContain(`__canvasLibs.${l.pkg === "three" ? "three" : "cannon"}=`);
      console.log(`${l.id}: ${src.length} bytes`);
    }
    expect(await librarySource(HOST_LIBRARIES[0])).toBe(await librarySource(HOST_LIBRARIES[0])); // 2 回目はメモリから
  });
});

describe("プレビューオリジンの配信", () => {
  const app = startApp({ hostPort: 4430, previewPort: 4431, devHarness: true });
  afterAll(() => app.stop());
  test("Worker の CSP は default-src 'none' のまま。宣言した作品だけにライブラリが付く", async () => {
    expect(WORKER_CSP).toBe("default-src 'none'");
    const t1 = app.tokens.issue({ title: "t", entry: three, libraries: ["three@0.187.0"] });
    const r1 = await fetch(app.previewOrigin + "/w/" + t1, { headers: { "sec-fetch-dest": "worker" } });
    expect(r1.headers.get("content-security-policy")).toBe("default-src 'none'");
    const s1 = await r1.text();
    expect(s1).toContain("// three@0.187.0");
    expect(s1).not.toContain("// cannon-es@0.20.0");
    const t2 = app.tokens.issue({ title: "t", entry });
    const s2 = await (await fetch(app.previewOrigin + "/w/" + t2, { headers: { "sec-fetch-dest": "worker" } })).text();
    expect(s2).not.toContain("（ホスト同梱）");
    expect(s2.length).toBeLessThan(20_000);
  });
  test("開発用の起動口は libraries を契約で検査する", async () => {
    const post = (b: unknown) => fetch(app.hostOrigin + "/api/dev/preview", { method: "POST", headers: { origin: app.hostOrigin, "content-type": "application/json" }, body: JSON.stringify(b) });
    expect((await post({ title: "t", entry: three, libraries: ["three@0.187.0"] })).status).toBe(200);
    expect((await post({ title: "t", entry: three })).status).toBe(422);
    expect((await post({ title: "t", entry, libraries: ["lodash@4.17.21"] })).status).toBe(422);
  });
  test("シェルの CSP で緩めたのは img-src data: だけ（通信・スクリプト・Worker・フォームは従来どおり）", () => {
    const c = shellCsp("http://localhost:1");
    expect(c).toContain("img-src data:");
    expect(c).not.toMatch(/img-src[^;]*(https?:|blob:|\*)/);
    for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "worker-src 'self'", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"]) expect(c).toContain(d);
    expect(c).not.toContain("unsafe");
  });
});

describe("作品からの SVG の通知", () => {
  test("型・id・長さを検査する", () => {
    expect(checkWorkerToShell({ type: "svg", id: 1, svg: "<svg/>" })).not.toBeNull();
    expect(checkWorkerToShell({ type: "svg", id: 0, svg: "<svg/>" })).toBeNull();
    expect(checkWorkerToShell({ type: "svg", id: 1.5, svg: "<svg/>" })).toBeNull();
    expect(checkWorkerToShell({ type: "svg", id: 1, svg: "" })).toBeNull();
    expect(checkWorkerToShell({ type: "svg", id: 1, svg: 3 })).toBeNull();
    expect(checkWorkerToShell({ type: "svg", id: 1, svg: "x".repeat(LIMITS.svgChars + 1) })).toBeNull();
    expect(checkWorkerToShell({ type: "svg", id: 1, svg: "<svg/>", url: "http://x" })).toBeNull();
  });
});

describe("直接生成の応答の形", () => {
  test("libraries を受け取り、作品の本体に渡す（空・省略なら付けない）", async () => {
    const { validateArtwork, DIRECT_SYSTEM, DIRECT_SYSTEM_P3 } = await import("../../eval/p3/cond-d");
    const base = { title: "t", entry, changes: "", unconfirmed: [], reply: "" };
    const a = validateArtwork({ ...base, libraries: ["three@0.187.0"] });
    expect(a.ok && a.value.body.libraries).toEqual(["three@0.187.0"]);
    const b = validateArtwork({ ...base, libraries: [] });
    expect(b.ok && "libraries" in b.value.body).toBe(false);
    expect(validateArtwork({ ...base, libraries: "three" }).ok).toBe(false);
    expect(DIRECT_SYSTEM).toContain("libraries");
    expect(DIRECT_SYSTEM_P3).not.toContain("libraries"); // P3 の記録用の文は変えない
  });
});
