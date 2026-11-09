import { describe, expect, test } from "bun:test";
import { artworkDigest, checkArtwork, checkData, MAX_ENTRY_BYTES } from "../../src/contract/artwork";
import { PreviewTokens, assembleWorkerScript } from "../../src/server/preview";

const entry = "canvasApp.start((api) => ({ frame() {} }));";

describe("作品契約 v1", () => {
  test("自己完結した単一エントリを受ける", () => expect(checkArtwork({ title: "t", entry }).ok).toBe(true));
  test("import 宣言・動的 import・importScripts・構文エラーを拒否する", () => {
    expect(checkArtwork({ title: "t", entry: `import x from "y";\n${entry}` }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry: `import("y");` }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry: `importScripts("y");` }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry: `canvasApp.start(` }).ok).toBe(false);
  });
  test("ラッパーを抜け出す構文を拒否する", () => {
    expect(checkArtwork({ title: "t", entry: `}); evil(); (function(){` }).ok).toBe(false);
  });
  test("UTF-8 で 128 KiB を超えると拒否する（多バイト文字で数える）", () => {
    const pad = "あ".repeat(Math.ceil(MAX_ENTRY_BYTES / 3) + 1); // 3 バイト文字
    expect(checkArtwork({ title: "t", entry: `// ${pad}\n${entry}` }).ok).toBe(false);
    expect(checkArtwork({ title: "t", entry: `// ${"a".repeat(MAX_ENTRY_BYTES - 200)}\n${entry}` }).ok).toBe(true);
  });
  test("未定義の項目・空の title を拒否する", () => {
    expect(checkArtwork({ title: "t", entry, deps: ["three"] }).ok).toBe(false);
    expect(checkArtwork({ title: " ", entry }).ok).toBe(false);
  });
  test("入力 JSON は 64 KiB まで", () => {
    expect(checkData({ a: "x".repeat(1000) }).ok).toBe(true);
    expect(checkData({ a: "x".repeat(65 * 1024) }).ok).toBe(false);
  });
  test("digest は内容と契約の版で決まる", async () => {
    const a = await artworkDigest({ title: "t", entry });
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await artworkDigest({ title: "t", entry })).toBe(a);
    expect(await artworkDigest({ title: "t", entry: entry + " " })).not.toBe(a);
  });
});

describe("プレビュートークン", () => {
  test("1 回だけ取り出せ、期限を過ぎると無効", () => {
    let now = 0;
    const t = new PreviewTokens(1000, () => now);
    const k = t.issue({ title: "t", entry });
    expect(t.take(k)).toBe(entry);
    expect(t.take(k)).toBeNull();
    const k2 = t.issue({ title: "t", entry });
    now = 2000;
    expect(t.take(k2)).toBeNull();
  });
  test("Worker スクリプトはブートストラップの後に作品を strict 関数で包む", () => {
    const s = assembleWorkerScript(entry);
    expect(s.indexOf("__canvasApp")).toBeLessThan(s.indexOf(entry));
    expect(s).toContain('"use strict";\n' + entry);
  });
});
