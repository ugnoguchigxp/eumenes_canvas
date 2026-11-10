// 作品 Worker のブートストラップ（src/preview/bootstrap.js）を、ブラウザなしの偽の Worker 環境で動かす試験。
// 01：土台とエラーの位置。02・05 で同じファイルに試験を足す。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleWorkerScript } from "../../src/server/preview";
import { ROOT } from "./support";

const BOOT = readFileSync(join(ROOT, "src/preview/bootstrap.js"), "utf8");

/** 偽の面（OffscreenCanvas の代わり）。描画の呼び出しは何もしない。 */
class FakeSurface {
  name = "surface";
  constructor(public width: number, public height: number) {}
  getContext() {
    return { setTransform() {}, clearRect() {}, drawImage() {}, fillRect() {} };
  }
  transferToImageBitmap() {
    return { width: this.width, height: this.height };
  }
}

/** 作品をブートストラップと連結して（配信と同じ組み立て）偽の self で実行する。 */
function boot(entry: string) {
  const posted: any[] = [];
  let onMessage: ((ev: { data: unknown }) => void) | null = null;
  // navigator の prototype は試験ごとの空の物にする（ブートストラップが prototype に getter を定義するため、Object.prototype を汚さない）
  const self = {
    postMessage: (m: unknown) => posted.push(m),
    addEventListener: (type: string, f: (ev: { data: unknown }) => void) => {
      if (type === "message") onMessage = f;
    },
    navigator: Object.create({}),
  };
  const script = assembleWorkerScript(entry);
  const offset = Number(/;__canvasEntryLine=(\d+);\(function \(canvasApp\) \{\n/.exec(script)![1]);
  new Function("self", "OffscreenCanvas", script)(self, FakeSurface);
  return { posted, send: (m: unknown) => onMessage!({ data: m }), offset };
}

const INIT = { type: "init", width: 480, height: 360, dpr: 1, data: null, seed: 1 };
const errorsOf = (posted: any[]) => posted.filter((m) => m.type === "error").map((m) => m.message as string);
/** stack を書き換えた例外を作品の中で投げる作品（行は __canvasEntryLine からの相対）。 */
const thrower = (message: string, line: string, col: number) =>
  `canvasApp.start((api) => ({\n  frame() {\n    const e = new Error(${JSON.stringify(message)}); e.stack = "Error: x\\n    at Object.frame (http://127.0.0.1:4301/w/tok_A-1:" + (${line}) + ":${col})"; throw e;\n  },\n}));`;

describe("ブートストラップ（偽の Worker 環境）", () => {
  test("従来の動作", () => {
    const w = boot("canvasApp.start((api) => ({ frame(t, dt) { api.status({ t, dt }); } }))");
    w.send(INIT);
    w.send({ type: "tick", t: 100 });
    w.send({ type: "tick", t: 116 });
    w.send({ type: "input", ev: { type: "keydown", key: "a", code: "KeyA" } });
    w.send({ type: "input", ev: { type: "pointermove", x: 1, y: 1 } });
    w.send({ type: "advance", ms: 40, seq: 7 });
    expect(w.posted.slice(0, 3).map((m) => m.type)).toEqual(["status", "frame", "ready"]);
    const st = w.posted.filter((m) => m.type === "status").map((m) => [m.value.t, m.value.dt]);
    expect(st).toEqual([[0, 0], [0, 0], [16, 16], [16, 0], [32, 16], [48, 16], [56, 8]]);
    expect(w.posted[w.posted.length - 1]).toEqual({ type: "advanced", seq: 7 });
  });
  test("エラーの位置", () => {
    const w = boot(thrower("boom", "__canvasEntryLine + 3", 15));
    w.send(INIT);
    expect(errorsOf(w.posted)[0]).toBe("frame: boom（作品の 3 行 15 列）");
  });
  test("ブートストラップの中の行", () => {
    const w = boot(thrower("x", "10", 15));
    w.send(INIT);
    expect(errorsOf(w.posted)[0]).toBe("frame: x");
  });
  test("長い文", () => {
    const w = boot(`canvasApp.start((api) => ({ frame() { const e = new Error("m".repeat(2000)); e.stack = "at f (http://127.0.0.1:4301/w/tok:" + (__canvasEntryLine + 1) + ":2)"; throw e; } }));`);
    w.send(INIT);
    const m = errorsOf(w.posted)[0];
    expect(m.length).toBeLessThanOrEqual(1000);
    expect(m.endsWith("（作品の 1 行 2 列）")).toBe(true);
  });
  test("ずれの値", () => {
    const w = boot("canvasApp.start((api) => ({ frame() {} }));");
    expect(w.offset).toBe(BOOT.split("\n").length - 1 + 3);
  });
});
