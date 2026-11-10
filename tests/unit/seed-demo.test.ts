// デモの投入スクリプト：通常の API でゲーム 4 題と描画 5 題を保存し、2 回目は同じ題名を飛ばす。
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { startCanvasApp } from "../../src/server/canvas-app";
import { CanvasService } from "../../src/core/service";
import { Store } from "../../src/core/store";
import { RecordedProvider } from "../../src/core/recorded-provider";
import { FakeObserver, P1, ROOT } from "./support";
import { seedDemo } from "../../scripts/seed-demo";

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
