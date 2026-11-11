// ページ直接モード（design.md §8、docs/artwork-contract-v2-page.md）。既定で無効のときに従来と同じであること、有効なときの契約・配信・CSP。
import { afterAll, describe, expect, test } from "bun:test";
import { artworkDigest, checkArtwork, CONTRACT_VERSION, PAGE_CONTRACT_VERSION } from "../../src/contract/artwork";
import { assemblePageScript, pageCsp, PreviewTokens, shellCsp } from "../../src/server/preview";
import { startApp } from "../../src/server/app";
import { browserArgsOf } from "../../src/server/main";
import { checkHostToShell, checkPageToShell, LIMITS } from "../../src/shared/messages.js";

const pageEntry = `const c = document.getElementById("stage").getContext("2d");\nfunction f(){ c.fillStyle = "#f00"; c.fillRect(0, 0, 10, 10); requestAnimationFrame(f); }\nrequestAnimationFrame(f);`;
const page = { title: "p", entry: pageEntry, runtime: "page" as const };

describe("契約：runtime", () => {
  test("既定（pageMode 無効）では runtime を未定義の項目として拒否する（従来と同じ）", () => {
    const r = checkArtwork(page);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("未定義の項目");
    expect(checkArtwork(page, { pageMode: false }).ok).toBe(false);
  });
  test("pageMode 有効では runtime: \"page\" だけを受け、普通のスクリプトとして構文を確かめる", () => {
    expect(checkArtwork(page, { pageMode: true })).toEqual({ ok: true, errors: [] });
    expect(checkArtwork({ ...page, runtime: "worker" }, { pageMode: true }).ok).toBe(false);
    expect(checkArtwork({ ...page, entry: "function (" }, { pageMode: true }).ok).toBe(false);
    // strict でない（with を使える）。canvasApp は無い
    expect(checkArtwork({ ...page, entry: "with (Math) { var x = PI; }" }, { pageMode: true }).ok).toBe(true);
    // ライブラリと同名の let・const は構文エラー（THREE は先に var で置かれる）
    expect(checkArtwork({ ...page, libraries: ["three@0.187.0"], entry: "const THREE = 1;" }, { pageMode: true }).ok).toBe(false);
    expect(checkArtwork({ ...page, libraries: ["three@0.187.0"], entry: "new THREE.Scene();" }, { pageMode: true }).ok).toBe(true);
  });
  test("pageMode 有効でも runtime の無い作品の扱いは変わらない", () => {
    expect(checkArtwork({ title: "w", entry: "canvasApp({ start(){} });" }, { pageMode: true }).ok).toBe(true);
  });
  test("digest：runtime の無い作品は従来と同じ、page は版 2 と runtime を入れて別の値", async () => {
    const w = { title: "p", entry: pageEntry };
    const expected = "sha256:" + new Bun.CryptoHasher("sha256").update(JSON.stringify({ contract: CONTRACT_VERSION, title: "p", entry: pageEntry, dataRef: null })).digest("hex");
    expect(await artworkDigest(w)).toBe(expected);
    const pd = "sha256:" + new Bun.CryptoHasher("sha256").update(JSON.stringify({ contract: PAGE_CONTRACT_VERSION, title: "p", entry: pageEntry, dataRef: null, runtime: "page" })).digest("hex");
    expect(await artworkDigest(page)).toBe(pd);
    expect(pd).not.toBe(expected);
  });
});

describe("メッセージ", () => {
  const start = { type: "start", runId: "r1", token: "a".repeat(32), data: null, seed: 1, clock: "manual" };
  test("start の runtime はあるときだけ \"page\"、直接描画と同時には使わない", () => {
    expect(checkHostToShell({ ...start, runtime: "page" })).not.toBeNull();
    expect(checkHostToShell({ ...start, runtime: "worker" })).toBeNull();
    expect(checkHostToShell({ ...start, runtime: "page", direct: true })).toBeNull();
    expect(checkHostToShell(start)).toEqual(start);
  });
  test("作品の文書→シェルは型の決まった通知だけ", () => {
    expect(checkPageToShell({ type: "ready" })).not.toBeNull();
    expect(checkPageToShell({ type: "escape" })).not.toBeNull();
    expect(checkPageToShell({ type: "advanced", seq: 3 })).not.toBeNull();
    expect(checkPageToShell({ type: "advanced", seq: "3" })).toBeNull();
    expect(checkPageToShell({ type: "ready", runId: "r1" })).toBeNull();
    expect(checkPageToShell({ type: "status", value: "x".repeat(5000) })).toBeNull();
    expect(checkPageToShell({ type: "error", message: "x".repeat(5000) })!.message.length).toBe(LIMITS.errorMessageChars);
    for (const type of ["save", "frame", "svg", "shell-ready", "stopped", "navigate"]) expect(checkPageToShell({ type })).toBeNull();
  });
});

describe("CSP と組み立て", () => {
  test("pageMode 無効のシェルの CSP は従来と同じ（frame-src を足さない）", () => {
    expect(shellCsp("http://localhost:1")).toBe(shellCsp("http://localhost:1", false));
    expect(shellCsp("http://localhost:1")).not.toContain("frame-src");
    expect(shellCsp("http://localhost:1", true)).toBe(shellCsp("http://localhost:1") + "; frame-src 'self'");
  });
  test("作品の文書の CSP は通信・Worker・入れ子の iframe・フォームを止め、スクリプトはプレビューオリジンだけ", () => {
    const c = pageCsp("http://127.0.0.1:2", "http://localhost:1");
    for (const d of ["default-src 'none'", "script-src http://127.0.0.1:2", "connect-src 'none'", "worker-src 'none'", "child-src 'none'", "frame-src 'none'", "object-src 'none'", "form-action 'none'", "base-uri 'none'", "frame-ancestors http://127.0.0.1:2 http://localhost:1"])
      expect(c).toContain(d);
    expect(c).not.toContain("unsafe-eval");
    expect(c).not.toMatch(/script-src[^;]*unsafe/);
  });
  test("作品の本文はライブラリを大域の名前で置いてから作品を続ける", () => {
    expect(assemblePageScript("x();")).toBe("\nx();\n");
    const s = assemblePageScript("x();", [{ lib: { id: "three@0.187.0", pkg: "three", version: "0.187.0", param: "THREE", shim: "three.js" } as any, source: "/*lib*/" }]);
    expect(s).toContain('var THREE = __canvasLibs["three"];');
    expect(s.trim().endsWith("x();")).toBe(true);
  });
  test("トークン：page は Worker の経路で取り出せず、文書の後に 1 回だけ本文を取り出せる", () => {
    const t = new PreviewTokens();
    const k = t.issue(page);
    expect(t.runtimeOf(k)).toBe("page");
    expect(t.takeRun(k)).toBeNull();
    expect(t.takePageRun(k)).toBeNull(); // 文書の前
    expect(t.servePageDoc(k)).toBe(true);
    expect(t.servePageDoc(k)).toBe(false);
    expect(t.takePageRun(k)?.entry).toBe(pageEntry);
    expect(t.takePageRun(k)).toBeNull();
    const w = t.issue({ title: "w", entry: "x" });
    expect(t.runtimeOf(w)).toBe("worker");
    expect(t.servePageDoc(w)).toBe(false);
    expect(t.takeRun(w)?.entry).toBe("x");
  });
});

describe("配信（pageMode 有効）", () => {
  const app = startApp({ hostPort: 4470, previewPort: 4471, devHarness: true, pageMode: true });
  afterAll(() => app.stop());
  const post = (b: unknown) => fetch(app.hostOrigin + "/api/dev/preview", { method: "POST", headers: { origin: app.hostOrigin, "content-type": "application/json" }, body: JSON.stringify(b) });
  test("/api/config は pageMode を返す。開発用の起動口は runtime を受ける", async () => {
    expect((await (await fetch(app.hostOrigin + "/api/config")).json()).pageMode).toBe(true);
    expect((await post(page)).status).toBe(200);
  });
  test("シェルの CSP に frame-src 'self'、シェルのスクリプトに PAGE_MODE = true", async () => {
    const r = await fetch(app.previewOrigin + "/shell.html");
    expect(r.headers.get("content-security-policy")).toContain("frame-src 'self'");
    expect(await (await fetch(app.previewOrigin + "/shell.js")).text()).toContain("const PAGE_MODE = true;");
  });
  test("作品の文書と本文：取得の種類・順序・回数を確かめる", async () => {
    const { token } = await (await post(page)).json();
    // Worker の経路では出さない（消費もしない）
    expect((await fetch(app.previewOrigin + "/w/" + token, { headers: { "sec-fetch-dest": "worker" } })).status).toBe(403);
    // 文書の前の本文は出さない
    expect((await fetch(app.previewOrigin + "/pw/" + token, { headers: { "sec-fetch-dest": "script" } })).status).toBe(410);
    expect((await fetch(app.previewOrigin + "/p/" + token, { headers: { "sec-fetch-dest": "script" } })).status).toBe(403);
    const doc = await fetch(app.previewOrigin + "/p/" + token, { headers: { "sec-fetch-dest": "iframe" } });
    expect(doc.status).toBe(200);
    expect(doc.headers.get("content-security-policy")).toBe(pageCsp(app.previewOrigin, app.hostOrigin));
    const html = await doc.text();
    expect(html).toContain('<canvas id="stage"');
    expect(html).toContain(`${app.previewOrigin}/page-runtime.js`);
    expect(html).not.toContain(pageEntry);
    expect((await fetch(app.previewOrigin + "/p/" + token, { headers: { "sec-fetch-dest": "iframe" } })).status).toBe(410);
    expect((await fetch(app.previewOrigin + "/pw/" + token, { headers: { "sec-fetch-dest": "iframe" } })).status).toBe(403);
    const body = await fetch(app.previewOrigin + "/pw/" + token, { headers: { "sec-fetch-dest": "script" } });
    expect(body.status).toBe(200);
    expect(body.headers.get("cross-origin-resource-policy")).toBeNull(); // 不透明オリジンの文書から読むため
    expect(body.headers.get("access-control-allow-origin")).toBe("null");
    expect(await body.text()).toContain(pageEntry);
    expect((await fetch(app.previewOrigin + "/pw/" + token, { headers: { "sec-fetch-dest": "script" } })).status).toBe(410);
    expect((await fetch(app.previewOrigin + "/page-runtime.js")).status).toBe(200);
  });
});

describe("配信（既定 = pageMode 無効）", () => {
  const app = startApp({ hostPort: 4472, previewPort: 4473, devHarness: true });
  afterAll(() => app.stop());
  test("従来と同じ：config に pageMode が無い、runtime は 422、ページの経路は 404、シェルの CSP に frame-src が無い", async () => {
    const cfg = await (await fetch(app.hostOrigin + "/api/config")).json();
    expect("pageMode" in cfg).toBe(false);
    const r = await fetch(app.hostOrigin + "/api/dev/preview", { method: "POST", headers: { origin: app.hostOrigin, "content-type": "application/json" }, body: JSON.stringify(page) });
    expect(r.status).toBe(422);
    for (const p of ["/page-runtime.js", "/p/x", "/pw/x"]) expect((await fetch(app.previewOrigin + p)).status).toBe(404);
    expect((await fetch(app.previewOrigin + "/shell.html")).headers.get("content-security-policy")).toBe(shellCsp(app.hostOrigin));
    expect(await (await fetch(app.previewOrigin + "/shell.js")).text()).toContain("const PAGE_MODE = false;");
  });
});

describe("観測のブラウザ", () => {
  test("ページ直接モードが有効なときだけ --site-per-process を足す（既定は従来と同じ）", () => {
    expect(browserArgsOf({})).toEqual([]);
    expect(browserArgsOf({ observerArgs: ["--x"] })).toEqual(["--x"]);
    expect(browserArgsOf({ pageMode: true })).toEqual(["--site-per-process"]);
    expect(browserArgsOf({ pageMode: true, observerArgs: ["--site-per-process"] })).toEqual(["--site-per-process"]);
  });
});
