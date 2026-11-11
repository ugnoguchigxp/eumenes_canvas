import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanvasConfig } from "../../src/server/main";
import type { Run } from "../../src/core/types";
import { ROOT } from "./support";

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  const until = performance.now() + 15_000;
  while (performance.now() < until) {
    const value = await read();
    if (value !== undefined) return value;
    await Bun.sleep(50);
  }
  throw new Error("試験用ホストから応答がなかった");
}

test.each([["SIGTERM", 0], ["SIGINT", 130]] as const)("観測後に %s を受けたホストは停止し、保存済みの版を再起動後に開ける", async (signal, exitCode) => {
  const temp = mkdtempSync(join(tmpdir(), "canvas-shutdown-"));
  const sockets = Array.from({ length: 2 }, () => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
  const [hostPort, previewPort] = sockets.map((socket) => socket.port!);
  await Promise.all(sockets.map((socket) => socket.stop(true)));
  const file = join(temp, "canvas.json");
  const config: CanvasConfig = {
    hostPort, previewPort, dataDir: temp, singleUser: true, datasets: [],
    model: { provider: "recorded", label: "shutdown-test", files: ["fixtures/p1/recordings.json"] },
  };
  await Bun.write(file, JSON.stringify(config));
  const origin = `http://localhost:${hostPort}`;
  const start = () => Bun.spawn([process.execPath, "src/server/main.ts", file], { cwd: ROOT, stdout: "ignore", stderr: "ignore" });
  let child = start();
  const ready = () => waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`試験用ホストが起動できなかった: ${child.exitCode}`);
    const response = await fetch(`${origin}/api/config`).catch(() => null);
    if (response?.ok) return true;
  });
  async function api<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(origin + path, body ? {
      method: "POST", headers: { origin, "content-type": "application/json", "x-canvas-session": "shutdown-test" }, body: JSON.stringify(body),
    } : {});
    expect(response.ok).toBe(true);
    return response.json() as Promise<T>;
  }
  try {
    await ready();
    const first = await api<Run>("/api/runs", { message: "落ち物ゲームを作って" });
    const candidate = await waitFor(async () => {
      const run = await api<Run>(`/api/runs/${first.id}`);
      expect(run.state).not.toBe("failed");
      return run.presentedCandidateId ?? undefined;
    });
    const saved = await api<{ artworkId: string; revision: number }>(`/api/candidates/${candidate}/save`, { expectedRevision: 0, idempotencyKey: "shutdown-save" });
    const running = await api<Run>("/api/runs", { message: "回避ゲームを作って" });
    expect(running.state).toBe("running");
    process.kill(child.pid, signal);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([child.exited, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("終了要求から6秒以内にホストが停止しなかった")), 6000);
      })]);
      expect(code).toBe(exitCode);
    } finally {
      clearTimeout(deadline);
    }

    child = start();
    await ready();
    expect(await api(`/api/artworks/${saved.artworkId}`)).toMatchObject({ currentRevision: 1 });
    expect(await api(`/api/runs/${running.id}`)).toMatchObject({ state: "failed", failure: "ホストの再起動で中断", candidateIds: [] });
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
    rmSync(temp, { force: true, recursive: true });
  }
}, 35_000);
