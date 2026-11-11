// 展開先にコピーし、配布物のモジュールだけを使って実行する。
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { artworkDigest } from "../../src/contract/artwork";
import { HOST_LIBRARIES } from "../../src/contract/libraries";
import { ObservationBrowser } from "../../src/core/harness-session";
import { PlaywrightObserver } from "../../src/core/observer";
import { makerSystem } from "../../src/core/prompt-maker";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { loadLibraries, PreviewTokens, previewHandler } from "../../src/server/preview";

const tokens = new PreviewTokens();
const paths: Record<string, string> = {
  "/harness.html": "src/host/harness.html",
  "/harness.css": "src/host/harness.css",
  "/harness.js": "src/host/harness.js",
  "/preview-client.js": "src/host/preview-client.js",
  "/shared/messages.js": "src/shared/messages.js",
};
const host = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req): Response {
  const path = new URL(req.url).pathname;
  if (path === "/api/config") return Response.json({ previewOrigin });
  return paths[path] ? new Response(Bun.file(paths[path])) : new Response("not found", { status: 404 });
} });
const hostOrigin = `http://localhost:${host.port}`;
const preview = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: previewHandler({ hostOrigin, tokens }) });
const previewOrigin = `http://127.0.0.1:${preview.port}`;
const observer = new PlaywrightObserver(hostOrigin, (body) => tokens.issue(body));
const browser = new ObservationBrowser([]);

try {
  const owner = "package-test";
  const body = { title: "落ち物ゲーム", entry: await Bun.file(process.argv[2]).text() };
  const digest = "sha256:2dc307fb3e37f2028bbdfc2e052f360471226b1b90c67d7afd260e446520b960";
  assert.equal(await artworkDigest(body), digest, "旧作品の digest が変わった");
  mkdirSync("store");
  await Bun.write("store/store.json", JSON.stringify({
    version: 1,
    artworks: { legacy: { id: "legacy", owner, title: body.title, currentRevision: 1, createdAt: 1, updatedAt: 1 } },
    revisions: { legacy: [{ artworkId: "legacy", revision: 1, parent: null, body, digest, verificationId: "v_legacy", candidateId: null, restoredFrom: null, createdAt: 1 }] },
    runs: {}, candidates: {}, receipts: {}, sessions: {},
    verifications: { v_legacy: { id: "v_legacy", digest, suite: "host-smoke/1", environment: "chromium", dataDigest: null,
      checks: ["contract", "loaded", "operated"].map((level) => ({ id: level, level, pass: true })), requiredPassed: true, createdAt: 1 } },
  }));
  const contract = await Bun.file("docs/artwork-contract-v1.md").text();
  assert(contract && makerSystem());
  const libs = await loadLibraries(HOST_LIBRARIES.map(({ id }) => id));
  assert.equal(libs.length, HOST_LIBRARIES.length);
  for (const { source } of libs) assert.match(source, /Permission is hereby granted/);
  const model = { label: "fixture", async generate() { return { body, changes: "", unconfirmed: [], reply: "" }; } };
  const service = () => new CanvasService({ store: new Store("store"), observer, model, contract });
  const svc = service();
  assert.equal(svc.resolvePreview(owner, { artworkId: "legacy" }).body.entry, body.entry);
  const run = await svc.startRun(owner, "package-test", { message: "固定の作品", artworkId: "legacy" });
  await svc.drain();
  const result = svc.getRun(owner, run.id);
  assert.equal(result.state, "presented", result.failure ?? "候補を提示できなかった");
  assert(result.presentedCandidateId);
  const saved = await svc.save(owner, result.presentedCandidateId, { expectedRevision: 1, idempotencyKey: "package-save" });
  assert.deepEqual(saved.result, { artworkId: "legacy", revision: 2, digest });
  const reopened = service();
  assert.equal(reopened.resolvePreview(owner, { artworkId: "legacy" }).body.entry, body.entry);
  assert.deepEqual(await reopened.save(owner, result.presentedCandidateId, { expectedRevision: 1, idempotencyKey: "package-save" }), { ...saved, replay: true });
  const restored = await reopened.restore(owner, "legacy", { revision: 1, expectedRevision: 2, idempotencyKey: "package-restore" });
  assert.deepEqual(restored.result, { artworkId: "legacy", revision: 3, digest, restoredFrom: 1 });
  const restarted = service();
  assert.deepEqual(await restarted.restore(owner, "legacy", { revision: 1, expectedRevision: 2, idempotencyKey: "package-restore" }), { ...restored, replay: true });
  assert.equal(restarted.getArtwork(owner, "legacy").revisions.length, 3);

  const page = await (await browser.get()).newPage();
  await page.goto(hostOrigin + "/harness.html");
  await page.waitForFunction(() => document.title === "ready", null, { timeout: 10_000 });
  const [worker, ready] = await Promise.all([
    page.waitForEvent("worker", { timeout: 10_000 }),
    page.evaluate((token) => (window as any).harness.startToken({ token }), tokens.issue(body)),
  ]);
  assert.equal(ready.type, "ready");
  const [, stop] = await Promise.all([
    worker.waitForEvent("close", { timeout: 2000 }),
    page.evaluate(() => (window as any).harness.stop()),
  ]);
  assert.equal(stop.method, "terminate");
  await page.getByRole("button", { name: "押す" }).click();
  assert.equal(await page.locator("#probe-count").textContent(), "1");
  console.log("旧保存版、観測、保存、再表示、復元、Workerの停止を確認");
} finally {
  try {
    await Promise.all([observer.close(), browser.close()]);
  } finally {
    host.stop(true);
    preview.stop(true);
  }
}
