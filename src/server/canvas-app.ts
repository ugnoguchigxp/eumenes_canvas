// 検証ホストの API。所有者は HttpOnly cookie、制作画面は x-canvas-session で区別する。
import { randomBytes } from "node:crypto";
import { CanvasService, ServiceError } from "../core/service";
import { HttpError, json, readJson, startApp } from "./app";
import { PreviewTokens } from "./preview";

const OWNER_COOKIE = "canvas_owner";
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

function cookieOwner(req: Request): string | null {
  const c = req.headers.get("cookie") ?? "";
  const m = c.match(/(?:^|;\s*)canvas_owner=([A-Za-z0-9_-]{16,64})/);
  return m ? m[1] : null;
}

export interface CanvasAppOptions {
  hostPort: number;
  previewPort: number;
  devHarness?: boolean;
  logDir?: string | null;
  makeService: (deps: { tokens: PreviewTokens; hostOrigin: string }) => CanvasService;
}

export function startCanvasApp(o: CanvasAppOptions) {
  const tokens = new PreviewTokens();
  let service: CanvasService | null = null;
  const app = startApp({
    hostPort: o.hostPort,
    previewPort: o.previewPort,
    devHarness: o.devHarness,
    logDir: o.logDir,
    tokens,
    onPage: (req): Record<string, string> => (cookieOwner(req) ? {} : { "set-cookie": `${OWNER_COOKIE}=${randomBytes(18).toString("base64url")}; Path=/; HttpOnly; SameSite=Strict` }),
    extraRoutes: async (req, url) => {
      if (!url.pathname.startsWith("/api/") || url.pathname === "/api/config" || url.pathname.startsWith("/api/dev/")) return null;
      const svc = service!;
      const owner = cookieOwner(req);
      if (!owner) throw new HttpError(401, "所有者 cookie がない");
      const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
      const m = req.method;
      try {
        if (parts[1] === "runs" && parts.length === 2 && m === "POST") {
          const session = req.headers.get("x-canvas-session") ?? "";
          if (!SESSION_RE.test(session)) throw new HttpError(400, "x-canvas-session がない");
          const b = (await readJson(req)) as any;
          return json(await svc.startRun(owner, session, { message: b.message, artworkId: b.artworkId ?? null, conversation: Array.isArray(b.conversation) ? b.conversation.filter((t: any) => t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string").map((t: any) => ({ role: t.role, text: t.text.slice(0, 4000) })) : [] }), 201);
        }
        if (parts[1] === "runs" && parts.length === 3 && m === "GET") return json(svc.getRun(owner, parts[2]));
        if (parts[1] === "runs" && parts[3] === "cancel" && m === "POST") return json(svc.cancelRun(owner, parts[2]));
        if (parts[1] === "candidates" && parts[3] === "save" && m === "POST") {
          const b = (await readJson(req)) as any;
          const r = await svc.save(owner, parts[2], { expectedRevision: Number(b.expectedRevision), idempotencyKey: b.idempotencyKey });
          return json({ ...(r.result as object), replay: r.replay }, r.status);
        }
        if (parts[1] === "artworks" && parts.length === 2 && m === "GET") return json(svc.listArtworks(owner));
        if (parts[1] === "artworks" && parts.length === 3 && m === "GET") return json(svc.getArtwork(owner, parts[2]));
        if (parts[1] === "artworks" && parts[3] === "restore" && m === "POST") {
          const b = (await readJson(req)) as any;
          const r = await svc.restore(owner, parts[2], { revision: Number(b.revision), expectedRevision: Number(b.expectedRevision), idempotencyKey: b.idempotencyKey });
          return json({ ...(r.result as object), replay: r.replay }, r.status);
        }
        if (parts[1] === "previews" && m === "POST") {
          const b = (await readJson(req)) as any;
          const { body, data } = svc.resolvePreview(owner, { candidateId: b.candidateId, artworkId: b.artworkId, revision: b.revision === undefined ? undefined : Number(b.revision) });
          return json({ token: tokens.issue(body), data, title: body.title });
        }
      } catch (e) {
        if (e instanceof ServiceError) throw new HttpError(e.status, e.message, e.extra);
        throw e;
      }
      return null;
    },
  });
  service = o.makeService({ tokens, hostOrigin: app.hostOrigin });
  return { ...app, service };
}
