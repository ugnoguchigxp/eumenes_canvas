import { describe, expect, test } from "bun:test";
import { checkHostToShell, checkShellToHost, checkWorkerToShell, LIMITS, makeRateWindow } from "../../src/shared/messages.js";

describe("ホスト→シェル", () => {
  const ok = { type: "start", runId: "r1", token: "a".repeat(32), data: null, seed: 1, clock: "manual" };
  test("正しい start を通す", () => expect(checkHostToShell(ok)).toEqual(ok));
  test("未知の項目・型・形式を拒否する", () => {
    expect(checkHostToShell({ ...ok, extra: 1 })).toBeNull();
    expect(checkHostToShell({ ...ok, clock: "fast" })).toBeNull();
    expect(checkHostToShell({ ...ok, token: "../../x" })).toBeNull();
    expect(checkHostToShell({ ...ok, seed: -1 })).toBeNull();
    expect(checkHostToShell({ type: "eval", code: "x" })).toBeNull();
    expect(checkHostToShell([ok])).toBeNull();
    expect(checkHostToShell({ type: "advance", runId: "r1", seq: 1, ms: LIMITS.maxAdvanceMs + 1 })).toBeNull();
  });
  test("64 KiB を超える入力データを拒否する", () => {
    expect(checkHostToShell({ ...ok, data: "x".repeat(65 * 1024) })).toBeNull();
  });
});

describe("シェル→ホスト", () => {
  test("実行 ID が違う通知を破棄する", () => {
    expect(checkShellToHost({ type: "ready", runId: "old" }, "new")).toBeNull();
    expect(checkShellToHost({ type: "ready", runId: "new" }, "new")).not.toBeNull();
  });
  test("過大な status を破棄する", () => {
    expect(checkShellToHost({ type: "status", runId: "a", value: "x".repeat(5000) }, "a")).toBeNull();
  });
  test("権限を求める型（save など）は存在しない", () => {
    for (const type of ["save", "fullscreen", "navigate", "fetch"]) expect(checkShellToHost({ type, runId: "a" }, "a")).toBeNull();
  });
});

describe("作品 Worker→シェル", () => {
  test("型の決まった通知だけを通す", () => {
    expect(checkWorkerToShell({ type: "ready" })).not.toBeNull();
    expect(checkWorkerToShell({ type: "ready", extra: 1 })).toBeNull();
    expect(checkWorkerToShell({ type: "frame", bitmap: {} })).toBeNull();
    expect(checkWorkerToShell("ready")).toBeNull();
    expect(checkWorkerToShell({ type: "error", message: "x".repeat(5000) })!.message.length).toBe(LIMITS.errorMessageChars);
  });
});

test("レート窓は 1 秒ごとに数え直す", () => {
  let t = 0;
  const w = makeRateWindow(() => t);
  w.hit();
  w.hit();
  expect(w.hit()).toBe(3);
  t = 1000;
  expect(w.hit()).toBe(1);
});
