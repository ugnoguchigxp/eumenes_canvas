// E2E 用の起動スクリプト。検証ホストと、外部通信の到達を数えるカナリアを起動する。

const HOST_PORT = Number(process.env.HOST_PORT ?? 4310);
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT ?? 4311);
const CANARY_PORT = Number(process.env.CANARY_PORT ?? 4312);

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

const app = await import("./app-factory").then((m) => m.createTestApp({ hostPort: HOST_PORT, previewPort: PREVIEW_PORT }));
console.log(`host ${app.hostOrigin} preview ${app.previewOrigin} canary http://127.0.0.1:${CANARY_PORT}`);
