// 作品 Worker のブートストラップ（src/preview/bootstrap.js）を、ブラウザなしの偽の Worker 環境で動かす試験。
// 01：土台とエラーの位置。02・05 で同じファイルに試験を足す。
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assembleWorkerScript } from "../../src/server/preview";
import { ROOT } from "./support";

const BOOT = readFileSync(join(ROOT, "src/preview/bootstrap.js"), "utf8");
const EXECUTION_BUDGET = readFileSync(join(ROOT, "src/preview/execution-budget.js"), "utf8");

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
function boot(entry: string, opts: { raf?: boolean } = {}) {
  const posted: any[] = [];
  let onMessage: ((ev: { data: unknown }) => void) | null = null;
  let rafQueue: ((now: number) => void)[] = [];
  // navigator の prototype は試験ごとの空の物にする（ブートストラップが prototype に getter を定義するため、Object.prototype を汚さない）
  const self: Record<string, unknown> = {
    postMessage: (m: unknown) => posted.push(m),
    addEventListener: (type: string, f: (ev: { data: unknown }) => void) => {
      if (type === "message") onMessage = f;
    },
    navigator: Object.create({}),
  };
  // 05：Worker 自身の時計（requestAnimationFrame）。渡された関数を積み、flushRaf(now) で呼ぶ
  if (opts.raf) self.requestAnimationFrame = (f: (now: number) => void) => rafQueue.push(f);
  const script = assembleWorkerScript(entry);
  const offset = Number(/;__canvasEntryLine=(\d+);\(function \(canvasApp\) \{\n/.exec(script)![1]);
  new Function("self", "OffscreenCanvas", script)(self, FakeSurface);
  const flushRaf = (now: number) => {
    const q = rafQueue;
    rafQueue = [];
    for (const f of q) f(now);
  };
  return { posted, send: (m: unknown) => onMessage!({ data: m }), offset, self, flushRaf };
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
    expect(w.offset).toBe(BOOT.split("\n").length - 1 + EXECUTION_BUDGET.split("\n").length + 3);
  });
  // 02：時間を進めない描き直し（poke）
  test("poke は t を変えずに frame(t, 0) を count 回呼び、advanced を返す", () => {
    const w = boot("let n = 0; canvasApp.start((api) => ({ frame(t, dt) { n++; api.status({ n, t, dt }); } }));");
    w.send(INIT);
    w.send({ type: "advance", ms: 32, seq: 1 });
    const before = w.posted.length;
    w.send({ type: "poke", seq: 2, count: 30 });
    const added = w.posted.slice(before).filter((m) => m.type === "status").map((m) => m.value);
    expect(added.length).toBe(30);
    expect(added.every((v) => v.dt === 0 && v.t === 32)).toBe(true);
    expect(w.posted[w.posted.length - 1]).toEqual({ type: "advanced", seq: 2 });
  });

  // 05：3D の面・直接描画・更新と描画の分離
  const types = (posted: any[]) => posted.map((m) => m.type);
  const st = (posted: any[]) => posted.filter((m) => m.type === "status").map((m) => m.value);
  test("update・draw", () => {
    const w = boot('canvasApp.start((api) => ({ update(t, dt) { api.status({ k: "u", dt }); }, draw(t) { api.status({ k: "d" }); } }));');
    w.send(INIT);
    const seg = () => st(w.posted).map((v) => v.k).join("");
    expect(seg()).toBe("d");
    w.send({ type: "advance", ms: 1000, seq: 1 });
    expect(seg()).toBe("d" + "u".repeat(63) + "d");
    w.send({ type: "input", ev: { type: "keydown", key: "a", code: "KeyA" } });
    expect(seg()).toBe("d" + "u".repeat(63) + "dd");
    w.send({ type: "poke", seq: 2, count: 30 });
    expect(seg()).toBe("d" + "u".repeat(63) + "ddd");
    expect(st(w.posted).filter((v) => v.k === "u").every((v) => v.dt > 0)).toBe(true);
  });
  test("frame が優先", () => {
    const w = boot('canvasApp.start((api) => ({ frame() { api.status("f"); }, update() { api.status("u"); }, draw() { api.status("d"); } }));');
    w.send(INIT);
    w.send({ type: "advance", ms: 16, seq: 1 });
    expect(st(w.posted)).toEqual(["f", "f"]);
  });
  test("複写方式の 3D の面", () => {
    const w = boot("canvasApp.start((api) => { self.__a = api.canvas3d; self.__b = api.canvas3d; return { frame() {} }; });");
    w.send({ ...INIT, dpr: 2 });
    const a = w.self.__a as FakeSurface;
    expect(a).toBe(w.self.__b as FakeSurface);
    expect([a.width, a.height]).toEqual([960, 720]);
    expect(types(w.posted)).toContain("frame");
  });
  test("3D の面を使わない作品", () => {
    const w = boot("canvasApp.start((api) => ({ frame() {} }));");
    w.send(INIT);
    expect(types(w.posted)).toEqual(["frame", "ready"]);
  });
  test("直接描画", () => {
    const w = boot("canvasApp.start((api) => { self.__api = api; return { frame(t, dt) { api.status([t, dt]); } }; });", { raf: true });
    const c2 = new FakeSurface(1, 1), c3 = new FakeSurface(1, 1);
    w.send({ ...INIT, canvas2d: c2, canvas3d: c3, selfClock: true });
    const api = w.self.__api as any;
    expect(api.canvas).toBe(c2);
    expect(api.canvas3d).toBe(c3);
    expect([c2.width, c2.height, c3.width, c3.height]).toEqual([480, 360, 480, 360]);
    w.flushRaf(1000);
    w.flushRaf(1016);
    expect(st(w.posted)).toEqual([[0, 0], [0, 0], [16, 16]]);
    w.send({ type: "tick", t: 5000 });
    expect(st(w.posted).length).toBe(3);
    w.send({ type: "resize", width: 240, height: 360, dpr: 1 });
    expect([c2.width, c3.width]).toEqual([240, 240]);
    expect(new Set(types(w.posted))).toEqual(new Set(["status", "ready"]));
  });
  test("直接描画で時計が無い", () => {
    const w = boot("canvasApp.start((api) => ({ frame(t, dt) { api.status([t, dt]); } }));");
    w.send({ ...INIT, canvas2d: new FakeSurface(1, 1), canvas3d: new FakeSurface(1, 1), selfClock: true });
    w.send({ type: "tick", t: 100 });
    w.send({ type: "tick", t: 116 });
    expect(st(w.posted)).toEqual([[0, 0], [0, 0], [16, 16]]);
  });
});
