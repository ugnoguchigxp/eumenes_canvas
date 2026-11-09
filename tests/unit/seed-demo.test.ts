// デモの投入スクリプト：通常の API で 4 題を保存し、2 回目は同じ題名を飛ばす。
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
  makeService: () => new CanvasService({ store: new Store(null), model: new RecordedProvider([P1, DEMO]), observer: new FakeObserver(), contract: "c" }),
});
afterAll(() => app.stop());

test("4 題を保存し、再実行では飛ばす。所有者を渡せばその所有者に入る", async () => {
  const quiet = () => {};
  const first = await seedDemo({ host: app.hostOrigin, log: quiet });
  expect(first.results.map((r) => [r.title, r.result])).toEqual([
    ["テトリス", "saved"],
    ["オセロ", "saved"],
    ["インベーダーゲーム", "saved"],
    ["ソリティア", "saved"],
  ]);
  const second = await seedDemo({ host: app.hostOrigin, owner: first.owner, log: quiet });
  expect(second.results.every((r) => r.result === "skipped")).toBe(true);
  const list = app.service.listArtworks(first.owner!);
  expect(list.map((a) => a.title).sort()).toEqual(["インベーダーゲーム", "オセロ", "ソリティア", "テトリス"].sort());
  // 別の所有者からは見えない
  const other = await seedDemo({ host: app.hostOrigin, log: quiet });
  expect(other.owner).not.toBe(first.owner);
  expect(other.results.every((r) => r.result === "saved")).toBe(true);
});
