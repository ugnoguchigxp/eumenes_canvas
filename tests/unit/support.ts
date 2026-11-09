import { readFileSync } from "node:fs";
import { join } from "node:path";
import { artworkDigest, type ArtworkBody } from "../../src/contract/artwork";
import type { ObservationResult, ObserverPort } from "../../src/core/observer";
import { RecordedProvider } from "../../src/core/recorded-provider";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";

export const ROOT = join(import.meta.dir, "../..");
export const P1 = join(ROOT, "fixtures/p1/recordings.json");
export const art = (f: string) => readFileSync(join(ROOT, "fixtures/p1/artworks", f), "utf8");

/** 作品の digest ごとに結果を決めた観測（ブラウザを使わない単体試験用）。既定は合格。 */
export class FakeObserver implements ObserverPort {
  readonly suite = "fake/1";
  fail = new Map<string, string>();
  calls = 0;
  async failFor(body: ArtworkBody, message: string) {
    this.fail.set(await artworkDigest(body), message);
  }
  async observe(body: ArtworkBody): Promise<ObservationResult> {
    this.calls++;
    const msg = this.fail.get(await artworkDigest(body));
    if (msg)
      return {
        environment: "fake",
        checks: [{ id: "boot", level: "loaded", pass: true }, { id: "no-runtime-error", level: "operated", pass: false, detail: msg }],
        observations: [{ kind: "runtime-error", message: msg }],
      };
    return { environment: "fake", checks: [{ id: "boot", level: "loaded", pass: true }, { id: "responds", level: "operated", pass: true }], observations: [] };
  }
  async close() {}
}

export function makeService(o: { dataDir?: string | null; runTimeoutMs?: number; deliverAfterAbort?: boolean; ignoreLatency?: boolean; observer?: FakeObserver; singleUser?: boolean } = {}) {
  const model = new RecordedProvider([P1], "p1");
  model.deliverAfterAbort = !!o.deliverAfterAbort;
  model.ignoreLatency = !!o.ignoreLatency;
  const observer = o.observer ?? new FakeObserver();
  const store = new Store(o.dataDir ?? null);
  const svc = new CanvasService({
    store,
    model,
    observer,
    contract: "contract",
    datasets: [{ ref: "synthetic-sales", description: "d", data: JSON.parse(readFileSync(join(ROOT, "fixtures/data/synthetic-sales.json"), "utf8")) }],
    runTimeoutMs: o.runTimeoutMs,
    singleUser: o.singleUser,
  });
  return { svc, store, model, observer };
}

export async function runToEnd(svc: CanvasService, owner: string, session: string, req: { message: string; artworkId?: string | null; conversation?: { role: "user" | "assistant"; text: string }[] }) {
  const run = await svc.startRun(owner, session, req);
  await svc.inflight.get(run.id);
  return svc.getRun(owner, run.id);
}

export const CONV = [
  { role: "user" as const, text: "落ち物ゲームを作って" },
  { role: "assistant" as const, text: "落ち物ゲームを作りました。" },
];
