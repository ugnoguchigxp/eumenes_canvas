// E2E 用の起動スクリプト。検証ホストと、外部通信の到達を数えるカナリアを起動する。

const HOST_PORT = Number(process.env.HOST_PORT ?? 4310);
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT ?? 4311);
const CANARY_PORT = Number(process.env.CANARY_PORT ?? 4312);
const SINGLE_HOST_PORT = Number(process.env.SINGLE_HOST_PORT ?? 4320);

const hits: { path: string; kind: string; at: number }[] = [];
Bun.serve({
  port: CANARY_PORT,
  hostname: "127.0.0.1",
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/__hits") return Response.json(hits);
    if (url.pathname === "/__reset") {
      hits.length = 0;
      return Response.json({ ok: true });
    }
    if (req.headers.get("upgrade") === "websocket") {
      hits.push({ path: url.pathname, kind: "ws", at: Date.now() });
      if (server.upgrade(req)) return undefined;
    }
    hits.push({ path: url.pathname, kind: "http", at: Date.now() });
    return new Response("postMessage({canary:true});", { headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" } });
  },
  websocket: { message() {} },
});

import { startBlobBaseline } from "./blob-baseline";
startBlobBaseline(4313, 4314);

const { createTestApp } = await import("./app-factory");
// 単一利用者モード（design.md §3）の検証ホスト。デモの固定応答も読み、通常の API でゲーム 4 題を入れてから試験を始める
// （試験側は読むだけにして、2 つのブラウザの試験が並行しても数が揺れないようにする。
// 描画 5 題も recordings にあるが、観測が長くこの試験の対象でもないので投入しない）
const single = createTestApp({ hostPort: SINGLE_HOST_PORT, previewPort: SINGLE_HOST_PORT + 1, singleUser: true, extraModelFiles: ["fixtures/demo/recordings.json"] });
const { seedDemo } = await import("../../../scripts/seed-demo");
const GAME_TITLES = ["テトリス", "オセロ", "インベーダーゲーム", "ソリティア"];
const seeded = await seedDemo({ host: single.hostOrigin, titles: GAME_TITLES, log: (s) => console.log(`[seed] ${s}`) });
if (seeded.results.some((r) => r.result !== "saved") || seeded.results.length !== GAME_TITLES.length) throw new Error("デモの投入に失敗: " + JSON.stringify(seeded.results));
const app = createTestApp({ hostPort: HOST_PORT, previewPort: PREVIEW_PORT });
console.log(`host ${app.hostOrigin} preview ${app.previewOrigin} canary http://127.0.0.1:${CANARY_PORT} single-user ${single.hostOrigin}`);
