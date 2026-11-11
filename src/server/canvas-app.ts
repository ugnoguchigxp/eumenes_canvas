// 検証ホストの API。制作画面は x-canvas-session で区別する。所有者は、単一利用者モードでは固定の `local`、
// そうでなければ HttpOnly cookie で区別する（design.md §3）。
import { randomBytes } from "node:crypto";
import { CanvasService, ServiceError } from "../core/service";
import type { Turn } from "../core/types";
import { HttpError, json, readJsonObject, startApp } from "./app";
import { PreviewTokens } from "./preview";

const OWNER_COOKIE = "canvas_owner";
/** 単一利用者モードで新しい記録に付ける所有者。 */
export const SINGLE_USER_OWNER = "local";
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;

function cookieOwner(req: Request): string | null {
  const c = req.headers.get("cookie") ?? "";
  const m = c.match(/(?:^|;\s*)canvas_owner=([A-Za-z0-9_-]{16,64})/);
  return m ? m[1] : null;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new HttpError(400, name + " は文字列");
  return value;
}

function revisionNumber(value: unknown, name: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    throw new HttpError(400, name + " は " + min + " 以上の整数");
  return value;
}

function conversationOf(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  const turns: Turn[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { role, text } = item as Record<string, unknown>;
    if ((role === "user" || role === "assistant") && typeof text === "string")
      turns.push({ role, text: text.slice(0, 4000) });
  }
  return turns;
}

export interface CanvasAppOptions {
  hostPort: number;
  previewPort: number;
  devHarness?: boolean;
  logDir?: string | null;
  /** 単一利用者モード。所有者 cookie を発行・要求せず、全要求を所有者 `local` として扱う。makeService には同じ値を渡す。 */
  singleUser?: boolean;
  /** 直接描画を有効にするか（startApp に渡す）。 */
  directRender?: boolean;
  /** ページ直接モードを有効にするか（startApp に渡す。既定は無効）。 */
  pageMode?: boolean;
  makeService: (deps: { tokens: PreviewTokens; hostOrigin: string; singleUser: boolean }) => CanvasService;
}

export function startCanvasApp(o: CanvasAppOptions) {
  const tokens = new PreviewTokens();
  let service: CanvasService | null = null;
  const app = startApp({
    hostPort: o.hostPort,
    previewPort: o.previewPort,
    devHarness: o.devHarness,
    logDir: o.logDir,
    directRender: o.directRender,
    pageMode: o.pageMode,
    tokens,
    onPage: (req): Record<string, string> => (o.singleUser || cookieOwner(req) ? {} : { "set-cookie": `${OWNER_COOKIE}=${randomBytes(18).toString("base64url")}; Path=/; HttpOnly; SameSite=Strict` }),
    extraRoutes: async (req, url) => {
      if (!url.pathname.startsWith("/api/") || url.pathname === "/api/config" || url.pathname.startsWith("/api/dev/")) return null;
      const svc = service!;
      const owner = o.singleUser ? SINGLE_USER_OWNER : cookieOwner(req);
      if (!owner) throw new HttpError(401, "所有者 cookie がない");
      const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
      const m = req.method;
      try {
        if (parts[1] === "runs" && parts.length === 2 && m === "POST") {
          const session = req.headers.get("x-canvas-session") ?? "";
          if (!SESSION_RE.test(session)) throw new HttpError(400, "x-canvas-session がない");
          const b = await readJsonObject(req);
          return json(await svc.startRun(owner, session, {
            message: requiredString(b.message, "message"),
            artworkId: b.artworkId == null ? null : requiredString(b.artworkId, "artworkId"),
            conversation: conversationOf(b.conversation),
          }), 201);
        }
        if (parts[1] === "runs" && parts.length === 3 && m === "GET") return json(svc.getRun(owner, parts[2]));
        if (parts[1] === "runs" && parts[3] === "cancel" && m === "POST") return json(await svc.cancelRun(owner, parts[2]));
        if (parts[1] === "candidates" && parts[3] === "save" && m === "POST") {
          const b = await readJsonObject(req);
          const r = await svc.save(owner, parts[2], {
            expectedRevision: revisionNumber(b.expectedRevision, "expectedRevision", 0),
            idempotencyKey: requiredString(b.idempotencyKey, "idempotencyKey"),
          });
          return json({ ...(r.result as object), replay: r.replay }, r.status);
        }
        if (parts[1] === "artworks" && parts.length === 2 && m === "GET") return json(svc.listArtworks(owner));
        if (parts[1] === "artworks" && parts.length === 3 && m === "GET") return json(svc.getArtwork(owner, parts[2]));
        if (parts[1] === "artworks" && parts[3] === "restore" && m === "POST") {
          const b = await readJsonObject(req);
          const r = await svc.restore(owner, parts[2], {
            revision: revisionNumber(b.revision, "revision", 1),
            expectedRevision: revisionNumber(b.expectedRevision, "expectedRevision", 1),
            idempotencyKey: requiredString(b.idempotencyKey, "idempotencyKey"),
          });
          return json({ ...(r.result as object), replay: r.replay }, r.status);
        }
        if (parts[1] === "previews" && m === "POST") {
          const b = await readJsonObject(req);
          const { body, data } = svc.resolvePreview(owner, {
            candidateId: b.candidateId === undefined ? undefined : requiredString(b.candidateId, "candidateId"),
            artworkId: b.artworkId === undefined ? undefined : requiredString(b.artworkId, "artworkId"),
            revision: b.revision === undefined ? undefined : revisionNumber(b.revision, "revision", 1),
          });
          return json({ token: tokens.issue(body), data, title: body.title, ...(body.runtime === "page" ? { runtime: "page" } : {}) });
        }
      } catch (e) {
        if (e instanceof ServiceError) throw new HttpError(e.status, e.message, e.extra);
        throw e;
      }
      return null;
    },
  });
  try {
    service = o.makeService({ tokens, hostOrigin: app.hostOrigin, singleUser: !!o.singleUser });
  } catch (err) {
    app.stop();
    throw err;
  }
  return { ...app, service };
}
