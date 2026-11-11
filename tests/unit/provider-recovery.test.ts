import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFromConfig } from "../../src/server/main";
import type { Run } from "../../src/core/types";
import { art, ROOT } from "./support";

test("接続先の停止で同時制作枠が満ちても、保存版を開けて復旧後に制作できる", async () => {
  const temp = mkdtempSync(join(tmpdir(), "canvas-provider-recovery-"));
  const held = Promise.withResolvers<void>();
  const allArrived = Promise.withResolvers<void>();
  let unavailable = false;
  let failedCalls = 0;
  const result = { title: "落ち物ゲーム", entry: art("falling-block.js"), reply: "作りました", changes: "新規制作", unconfirmed: [],
    spec: { requirements: ["ブロックを左右に動かせる"], controls: [] } };
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    await req.arrayBuffer();
    if (unavailable) {
      if (++failedCalls === 5) allArrived.resolve();
      await held.promise;
      return new Response("provider diagnostic context", { status: 503 });
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  } });
  const sockets = Array.from({ length: 2 }, () => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
  const [hostPort, previewPort] = sockets.map((socket) => socket.port!);
  await Promise.all(sockets.map((socket) => socket.stop(true)));
  let app: ReturnType<typeof runFromConfig> | undefined;
  try {
    app = runFromConfig({ hostPort, previewPort, singleUser: true, dataDir: temp, datasets: [],
      model: { provider: "openai-compatible", baseUrl: `http://127.0.0.1:${model.port}/v1`, label: "fixture", model: "fixture", timeoutMs: 10_000 },
    }, ROOT);
    const origin = app.hostOrigin;
    const get = async <T>(path: string): Promise<T> => {
      const response = await fetch(origin + path);
      expect(response.ok).toBe(true);
      return response.json() as Promise<T>;
    };
    const post = (path: string, session: string, body: object) => fetch(origin + path, {
      method: "POST", headers: { origin, "content-type": "application/json", "x-canvas-session": session }, body: JSON.stringify(body),
    });
    const start = async (session: string) => {
      const response = await post("/api/runs", session, { message: "落ち物ゲームを作って" });
      expect(response.status).toBe(201);
      return (await response.json() as Run).id;
    };
    async function complete(id: string) {
      await app!.service.inflight.get(id);
      return get<Run>(`/api/runs/${id}`);
    }

    const first = await complete(await start("provider-initial"));
    expect(first.state).toBe("presented");
    const stored = await post(`/api/candidates/${first.presentedCandidateId}/save`, "provider-initial", { expectedRevision: 0, idempotencyKey: "provider-base-save" });
    expect(stored.status).toBe(200);
    const saved = await stored.json() as { artworkId: string; revision: number; digest: string };
    expect(saved.revision).toBe(1);

    unavailable = true;
    const sessions = Array.from({ length: 5 }, (_, i) => `provider-batch-${i}`);
    const runs = await Promise.all(sessions.map(start));
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([allArrived.promise, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("制作枠の5件が接続先に届かなかった")), 5000);
      })]);
    } finally {
      clearTimeout(deadline);
    }
    const overflow = await post("/api/runs", "provider-overflow", { message: "落ち物ゲームを作って" });
    expect(overflow.status).toBe(429);
    expect(await overflow.json()).toMatchObject({ code: "run-capacity" });
    const preview = await post("/api/previews", "provider-initial", { artworkId: saved.artworkId, revision: 1 });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ title: "落ち物ゲーム" });
    expect(await get(`/api/artworks/${saved.artworkId}`)).toMatchObject({ currentRevision: 1, revisions: [{ digest: saved.digest }] });

    unavailable = false;
    held.resolve();
    for (const run of await Promise.all(runs.map(complete))) {
      expect(run).toMatchObject({ state: "failed", failure: "生成に失敗: モデルの応答が得られない: 503", candidateIds: [] });
    }
    expect(failedCalls).toBe(5);
    expect(await Bun.file(join(temp, "store.json")).text()).not.toContain("provider diagnostic context");
    for (const run of await Promise.all((await Promise.all(sessions.map(start))).map(complete))) {
      expect(run.state).toBe("presented");
      expect(run.presentedCandidateId).toBeTruthy();
    }
    expect(await get(`/api/artworks/${saved.artworkId}`)).toMatchObject({ currentRevision: 1, revisions: [{ digest: saved.digest }] });
  } finally {
    held.resolve();
    app?.stop();
    await Promise.all([app?.service.close(), model.stop(true)]);
    rmSync(temp, { recursive: true, force: true });
  }
}, 45_000);
