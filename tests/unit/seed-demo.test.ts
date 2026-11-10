// デモの投入スクリプト：通常の API でゲーム 4 題と描画 5 題を保存し、2 回目は同じ版を飛ばす。サーバーなしの投入・新しい版・待ち受け中の拒否。
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { startCanvasApp } from "../../src/server/canvas-app";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { RecordedProvider } from "../../src/core/recorded-provider";
import { FakeObserver, P1, ROOT } from "./support";
import { DemoReplaceModel, runningHostMessage, seedDemo, seedDemoOffline, SeedRefused } from "../../scripts/seed-demo";
import type { CanvasConfig } from "../../src/server/main";

const DEMO = join(ROOT, "fixtures/demo/recordings.json");
const app = startCanvasApp({
  hostPort: 4440,
  previewPort: 4441,
  singleUser: true,
  makeService: ({ singleUser }) => new CanvasService({ store: new Store(null), model: new RecordedProvider([P1, DEMO]), observer: new FakeObserver(), contract: "c", singleUser }),
});
afterAll(() => app.stop());

const TITLES = ["テトリス", "オセロ", "インベーダーゲーム", "ソリティア", "Three.js の場面", "マーブルラン", "ピンボール", "ブラックホール", "HTML in canvas のカード"];

test("単一利用者モードでは 9 題を保存し、再実行では飛ばす（cookie なし）", async () => {
  const quiet = () => {};
  const first = await seedDemo({ host: app.hostOrigin, log: quiet });
  expect(first.owner).toBeNull();
  expect(first.results.map((r) => [r.title, r.result])).toEqual(TITLES.map((title) => [title, "saved"]));
  const second = await seedDemo({ host: app.hostOrigin, log: quiet });
  expect(second.results.every((r) => r.result === "skipped")).toBe(true);
  const list = (await (await fetch(app.hostOrigin + "/api/artworks")).json()) as { title: string }[];
  expect(list.map((a) => a.title).sort()).toEqual([...TITLES].sort());
});

// ---- サーバーなしの投入（seedDemoOffline） ----

/** マーブルランだけ本体を変えた「古い版」の固定応答を一時ディレクトリに作る。 */
function oldRecordings(dir: string) {
  const j = JSON.parse(readFileSync(DEMO, "utf8"));
  const src = dirname(DEMO);
  for (const rec of j.recordings) {
    const abs = join(src, rec.output.entryFile);
    if (rec.output.title === "マーブルラン") {
      writeFileSync(join(dir, "old-marble.js"), readFileSync(abs, "utf8") + "\n// 旧版\n");
      rec.output.entryFile = "old-marble.js";
    } else rec.output.entryFile = relative(dir, abs);
  }
  const f = join(dir, "old.json");
  writeFileSync(f, JSON.stringify(j));
  return f;
}

const cfgFor = (dataDir: string, hostPort: number): CanvasConfig => ({
  hostPort,
  previewPort: hostPort + 1,
  dataDir,
  singleUser: true,
  model: { provider: "recorded", label: "t", files: ["fixtures/p1/recordings.json", "fixtures/demo/recordings.json"] },
  datasets: [],
});

test("サーバーなし：違う版は同じ作品の新しい版、同じ版は飛ばす、再実行はすべて飛ばす", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-offline-"));
  const dataDir = join(dir, "data");
  // 利用者の状態（古い版の 9 題が r1）を、通常の経路で作る
  const old = oldRecordings(dir);
  const pre = startCanvasApp({
    hostPort: 4450,
    previewPort: 4451,
    singleUser: true,
    makeService: ({ singleUser }) => new CanvasService({ store: new Store(dataDir), model: new RecordedProvider([P1, old]), observer: new FakeObserver(), contract: "c", singleUser }),
  });
  const seeded = await seedDemo({ host: pre.hostOrigin, recordings: old, log: () => {} });
  pre.stop();
  expect(seeded.results.every((r) => r.result === "saved")).toBe(true);

  const cfg = cfgFor(dataDir, 4452);
  const first = await seedDemoOffline({ config: cfg, observer: new FakeObserver(), log: () => {} });
  expect(first.bound.hostPort).not.toBe(4452);
  expect(first.results.filter((r) => r.result === "updated").map((r) => [r.title, r.fromRevision, r.revision])).toEqual([["マーブルラン", 1, 2]]);
  expect(first.results.filter((r) => r.result === "skipped").length).toBe(8);
  const second = await seedDemoOffline({ config: cfg, observer: new FakeObserver(), log: () => {} });
  expect(second.results.every((r) => r.result === "skipped")).toBe(true);

  // 作品は増えず、マーブルランは同じ作品に r1・r2 がある
  const s = JSON.parse(readFileSync(join(dataDir, "store.json"), "utf8"));
  const arts = Object.values(s.artworks) as { id: string; title: string; currentRevision: number }[];
  expect(arts.length).toBe(9);
  const marble = arts.find((a) => a.title === "マーブルラン")!;
  expect(marble.currentRevision).toBe(2);
  expect(s.revisions[marble.id].map((r: any) => [r.revision, r.parent])).toEqual([[1, null], [2, 1]]);
  // 一時ホストの待ち受けは残らない
  expect(await fetch(`http://127.0.0.1:${first.bound.hostPort}/`).then(() => true, () => false)).toBe(false);
});

test("サーバーなし：設定のホストポートが待ち受けていれば書き込まずに止まる", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-guard-"));
  const busy = Bun.serve({ port: 4454, hostname: "127.0.0.1", fetch: () => new Response("") });
  try {
    const cfg = cfgFor(join(dir, "data"), 4454);
    const msg = await runningHostMessage(cfg);
    expect(msg).toContain("検証ホストが動いています（ポート 4454");
    expect(msg).toContain("止めてから");
    await expect(seedDemoOffline({ config: cfg, observer: new FakeObserver(), log: () => {} })).rejects.toBeInstanceOf(SeedRefused);
    expect(await Bun.file(join(dir, "data", "store.json")).exists()).toBe(false);
  } finally {
    busy.stop(true);
  }
});

test("DemoReplaceModel は記録を引く鍵から基準だけを外す", async () => {
  const seen: any[] = [];
  const m = new DemoReplaceModel({ label: "x", generate: async (i) => (seen.push(i), { body: { title: "t", entry: "" }, changes: "", unconfirmed: [], reply: "" }) });
  await m.generate({ request: "r", conversation: [], base: { title: "b", entry: "e" }, baseDigest: "sha256:x", contract: "c", datasets: [], attempt: 0, previous: null, previousDigest: null, observations: [] }, new AbortController().signal);
  expect(seen[0].base).toBeNull();
  expect(seen[0].baseDigest).toBeNull();
  expect(seen[0].request).toBe("r");
});
