// 02：画素の道具（src/core/pixels.ts）。合成した画面で、要素の色と外接矩形が画素単位で一致すること。
import { describe, expect, test } from "bun:test";
import { blobOf, describeScene, diffShots, dominantColor, isSingleColor, parseHex, rgbHex, sceneText, type Shot } from "../../src/core/pixels";

type RGB = [number, number, number];
/** 背景色で塗った RGBA の画面に、矩形 [x, y, w, h, 色] を順に塗る。 */
function img(w: number, h: number, bg: RGB, rects: [number, number, number, number, RGB][] = []): Shot {
  const data = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) data.set([bg[0], bg[1], bg[2], 255], p * 4);
  for (const [x, y, rw, rh, c] of rects)
    for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) data.set([c[0], c[1], c[2], 255], (yy * w + xx) * 4);
  return { width: w, height: h, data };
}
const BLACK: RGB = [0, 0, 0], GREEN: RGB = [0, 255, 0], GRAY: RGB = [128, 128, 128], YELLOW: RGB = [255, 255, 0], WHITE: RGB = [255, 255, 255], RED: RGB = [255, 0, 0];
const flat = (s: ReturnType<typeof describeScene>) => s.items.map((i) => [i.color, i.box.x, i.box.y, i.box.w, i.box.h, i.area]);

describe("画素の道具", () => {
  test("差分", () => {
    const a = img(480, 360, BLACK, [[60, 280, 20, 20, GREEN]]);
    const b = img(480, 360, BLACK, [[60, 200, 20, 20, GREEN]]);
    expect(diffShots(a, a)).toEqual({ pixels: 0, box: null });
    expect(diffShots(a, b)).toEqual({ pixels: 800, box: { x: 60, y: 200, w: 20, h: 100 } });
    expect(diffShots(a, img(240, 360, BLACK)).pixels).toBe(172800);
  });
  test("要約", () => {
    const s = img(480, 360, BLACK, [[0, 320, 480, 4, GRAY], [40, 288, 16, 32, GREEN], [8, 4, 8, 8, YELLOW], [20, 4, 8, 8, YELLOW], [301, 101, 3, 3, WHITE]]);
    const sc = describeScene(s);
    expect(sc.background).toBe("#000000");
    expect(flat(sc)).toEqual([
      ["#808080", 0, 320, 480, 4, 1920],
      ["#00ff00", 40, 288, 16, 32, 512],
      ["#ffff00", 8, 4, 8, 8, 64],
      ["#ffff00", 20, 4, 8, 8, 64],
      ["#ffffff", 301, 101, 3, 3, 9],
    ]);
    expect(sceneText(sc)).toContain("#00ff00 左上(40,288) 幅16 高さ32 画素512");
  });
  test("接する別の色", () => {
    const sc = describeScene(img(480, 360, BLACK, [[0, 330, 480, 30, GRAY], [30, 306, 16, 24, GREEN]]));
    expect(sc.items.length).toBe(2);
    expect(sc.items[1]).toEqual({ color: "#00ff00", box: { x: 30, y: 306, w: 16, h: 24 }, area: 384 });
  });
  test("上限", () => {
    const rects: [number, number, number, number, RGB][] = [];
    for (let i = 0; i < 40; i++) rects.push([(i % 10) * 20, Math.floor(i / 10) * 20, 6, 6, WHITE]);
    const sc = describeScene(img(480, 360, BLACK, rects), 24);
    expect(sc.items.length).toBe(24);
    expect(sc.omitted).toBe(16);
    expect(sceneText(sc)).toContain("（ほかに小さい要素 16 個を省略）");
  });
  test("小さいまとまり", () => {
    const sc = describeScene(img(100, 100, BLACK, [[10, 10, 1, 2, RED], [50, 50, 2, 2, RED]]));
    expect(sc.items.map((i) => i.area)).toEqual([4]);
    expect(sc.omitted).toBe(1);
  });
  test("単色", () => {
    const s = img(64, 48, BLACK);
    const sc = describeScene(s);
    expect(sc.items).toEqual([]);
    expect(isSingleColor(s)).toBe(true);
    expect(sceneText(sc)).toBe("画面 64×48、背景 #000000。要素 0 個");
  });
  test("速さ", () => {
    const s = img(640, 480, BLACK);
    for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) if ((x + y) % 2) s.data.set([255, 255, 255], (y * 640 + x) * 4);
    const t0 = performance.now();
    const sc = describeScene(s);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(sc.items.length).toBe(0);
    expect(isSingleColor(s)).toBe(false);
  });
  test("色のまとまり", () => {
    const s = img(100, 50, [16, 16, 16], [[10, 20, 4, 6, RED]]);
    expect(blobOf(s, 0xff0000)).toEqual({ pixels: 24, box: { x: 10, y: 20, w: 4, h: 6 }, cx: 11.5, cy: 22.5 });
    expect(blobOf(s, 0x0000ff)).toEqual({ pixels: 0, box: null, cx: null, cy: null });
    expect(dominantColor(s)).toBe(0x101010);
  });
  test("色の文字列", () => {
    expect(parseHex("#00ff80")).toEqual([0, 255, 128]);
    expect(parseHex("red")).toBeNull();
    expect(rgbHex(0, 255, 128)).toBe("#00ff80");
  });
});
