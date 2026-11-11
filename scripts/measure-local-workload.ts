import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { artworkDigest } from "../src/contract/artwork";
import type { Artwork, Candidate, Revision, Run, Verification } from "../src/core/types";
import { runFromConfig, type CanvasConfig } from "../src/server/main";

const root = resolve(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "canvas-load-"));
const title = "履歴の計測";
const base = await Bun.file(join(root, "fixtures/p1/artworks/falling-block.js")).text();
const model: CanvasConfig["model"] = { provider: "recorded", label: "p1-fixtures+demo", files: ["fixtures/p1/recordings.json", "fixtures/demo/recordings.json"] };

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (fraction: number) => Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(1));
  return { count: sorted.length, p50: pick(0.5), p90: pick(0.9), max: pick(1) };
}

async function childRssMiB() {
  // macOS の測定。実行名や引数を読まず、今回のホストから起動した子だけを合計する。
  const ps = Bun.spawn(["ps", "-axo", "pid=,ppid=,rss="], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(ps.stdout).text();
  assert.equal(await ps.exited, 0);
  const entries = output.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  const parents = new Set([process.pid]);
  let size = 0;
  while (size !== parents.size) {
    size = parents.size;
    for (const [pid, parent] of entries) if (parents.has(parent)) parents.add(pid);
  }
  const kib = entries.reduce((sum, [pid, , rss]) => sum + (pid !== process.pid && parents.has(pid) ? rss : 0), 0);
  return Number((kib / 1024).toFixed(1));
}

async function populate(file: string, count: number) {
  const artworks: Record<string, Artwork> = {};
  const revisions: Record<string, Revision[]> = {};
  const runs: Record<string, Run> = {};
  const candidates: Record<string, Candidate> = {};
  const verifications: Record<string, Verification> = {};
  for (let offset = 0; offset < count; offset += 10) {
    const artworkId = `historical-${offset}`;
    artworks[artworkId] = { id: artworkId, owner: "local", title, currentRevision: 10, createdAt: offset, updatedAt: offset + 10 };
    const history: Revision[] = [];
    revisions[artworkId] = history;
    for (let revision = 1; revision <= 10; revision++) {
      const n = offset + revision;
      const body = { title, entry: `${base}\n/* ${n} ${"x".repeat(16 * 1024 - base.length)} */` };
      const digest = await artworkDigest(body);
      const runId = `historical-run-${n}`, candidateId = `historical-candidate-${n}`, verificationId = `historical-check-${n}`;
      runs[runId] = { id: runId, owner: "local", session: `historical-session-${n}`, artworkId, isNew: revision === 1, baseRevision: revision - 1,
        baseDigest: history.at(-1)?.digest ?? null, generation: 1, request: { message: title, conversation: [] }, state: "presented", deadline: n + 180000,
        attempts: 1, candidateIds: [candidateId], presentedCandidateId: candidateId, failure: null, createdAt: n, finishedAt: n };
      candidates[candidateId] = { id: candidateId, runId, owner: "local", artworkId, baseRevision: revision - 1, generation: 1,
        attempt: 0, body, digest, changes: "", unconfirmed: [], reply: "", verificationId, createdAt: n };
      verifications[verificationId] = { id: verificationId, digest, suite: "host-smoke/3", environment: "fixture", dataDigest: null,
        checks: [{ id: "contract", level: "contract", pass: true }, { id: "boot", level: "loaded", pass: true },
          { id: "responds", level: "operated", pass: true }], requiredPassed: true, createdAt: n };
      history.push({ artworkId, revision, parent: revision > 1 ? revision - 1 : null, body, digest, verificationId, candidateId, restoredFrom: null, createdAt: n });
    }
  }
  await Bun.write(file, JSON.stringify({ version: 1, artworks, revisions, runs, candidates, verifications, receipts: {}, sessions: {} }));
}

async function measure(historyCount: number, rounds: number) {
  const dataDir = join(work, String(historyCount));
  const file = join(dataDir, "store.json");
  await populate(file, historyCount);
  const initialBytes = statSync(file).size;
  const reserves = Array.from({ length: 2 }, () => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
  const [hostPort, previewPort] = reserves.map((server) => server.port!);
  await Promise.all(reserves.map((server) => server.stop(true)));
  const app = runFromConfig({ hostPort, previewPort, dataDir, singleUser: true, model, datasets: [], runTimeoutMs: 180_000, directRender: true }, root);
  let browser: Browser | undefined;
  const start: number[] = [], preview: number[] = [], saves: number[] = [], loop: number[] = [], list: number[] = [], rss: number[] = [];
  const sections = [];
  let round = -1;

  async function usePage(page: Page, index: number, measured: boolean) {
    const t0 = performance.now();
    await page.locator("#message").fill("落ち物ゲームを作って");
    await page.locator("#send").click();
    await page.locator("#candidate:not([hidden])").waitFor();
    const candidateAt = performance.now();
    await page.locator('#preview-host[data-ready="1"]').waitFor();
    const playableAt = performance.now();
    await page.locator("#save").click();
    await page.getByText("保存しました（r1）", { exact: true }).waitFor();
    const savedAt = performance.now();
    if (measured) {
      start.push(candidateAt - t0);
      preview.push(playableAt - candidateAt);
      saves.push(savedAt - playableAt);
    }
    await page.getByText("落ち物ゲーム（現在 r1）", { exact: true }).waitFor().catch((error) => {
      throw new Error(`画面 ${index}、試行 ${round} の保存確認に失敗`, { cause: error });
    });
  }

  let sample: ReturnType<typeof setInterval> | undefined;
  try {
    browser = await chromium.launch({ chromiumSandbox: process.platform === "darwin" });
    const pages = [];
    for (let index = 0; index < 5; index++) pages.push(await browser.newPage());
    for (const page of pages) await page.goto(app.hostOrigin + "/?clock=manual");
    await usePage(pages[0], 0, false);
    let previous = performance.now();
    sample = setInterval(() => {
      const now = performance.now();
      loop.push(Math.max(0, now - previous - 20));
      previous = now;
      rss.push(process.memoryUsage.rss() / 1024 ** 2);
    }, 20);
    const startedAt = performance.now();
    let mark = { artwork: 0, loop: 0, list: 0, rss: 0 };
    for (round = 0; round < rounds; round++) {
      for (const page of pages) await page.locator("#new-artwork").click();
      let sampling = true;
      const listSample = (async () => {
        while (sampling) {
          const now = performance.now();
          const response = await fetch(app.hostOrigin + "/api/artworks");
          assert.equal(response.status, 200);
          await response.arrayBuffer();
          list.push(performance.now() - now);
          await Bun.sleep(50);
        }
      })();
      try { await Promise.all(pages.map((page, index) => usePage(page, index, true))); }
      finally { sampling = false; await listSample; }
      if ((round + 1) % 5 === 0 || round + 1 === rounds) {
        const now = { artwork: saves.length, loop: loop.length, list: list.length, rss: rss.length };
        sections.push({ throughRound: round + 1, candidateMs: summary(start.slice(mark.artwork, now.artwork)), saveMs: summary(saves.slice(mark.artwork, now.artwork)),
          listMs: summary(list.slice(mark.list, now.list)), eventLoopLagMs: summary(loop.slice(mark.loop, now.loop)), hostRssMiB: summary(rss.slice(mark.rss, now.rss)),
          childRssMiBAfterRound: process.platform === "darwin" ? await childRssMiB() : null });
        mark = now;
      }
    }
    const wallMs = Math.round(performance.now() - startedAt);
    assert.equal(app.service.listArtworks("local").length, historyCount / 10 + rounds * 5 + 1);
    const log = (await Bun.file(join(dataDir, "logs/server.log")).text()).trimEnd().split("\n");
    const saveRequests = log.map((line) => JSON.parse(line) as { method?: string; path?: string; status?: number; ms?: number })
      .filter((event) => event.method === "POST" && event.path?.startsWith("/api/candidates/") && event.path.endsWith("/save"));
    assert.equal(saveRequests.length, saves.length + 1);
    const serverSaveMs = saveRequests.slice(1).map(({ ms, status }) => {
      assert.equal(status, 200);
      assert(typeof ms === "number");
      return ms;
    });
    return { historyCount, rounds, wallMs, initialBytes, finalBytes: statSync(file).size, candidateMs: summary(start), previewMs: summary(preview),
      saveMs: summary(saves), serverSaveMs: summary(serverSaveMs), listMs: summary(list), eventLoopLagMs: summary(loop), hostRssMiB: summary(rss), sections };
  } finally {
    clearInterval(sample);
    try { await browser?.close(); }
    finally {
      app.stop();
      await app.service.close();
    }
  }
}

try {
  const [volume, roundCount] = process.argv.slice(2);
  assert(volume === undefined || volume === "10" || volume === "1000", "履歴の件数は 10 または 1000");
  const rounds = roundCount === undefined ? 4 : Number(roundCount);
  assert(Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 30, "試行数は 1〜30 組");
  for (const count of volume ? [Number(volume)] : [10, 1000]) console.log(JSON.stringify(await measure(count, rounds)));
} finally {
  rmSync(work, { force: true, recursive: true });
}
