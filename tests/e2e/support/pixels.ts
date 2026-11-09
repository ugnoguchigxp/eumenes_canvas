// 画素観測。作品の自己申告ではなく、スクリーンショットの画素で判定する。
import { PNG } from "pngjs";
import type { Locator } from "@playwright/test";

export interface Shot {
  width: number;
  height: number;
  scale: number; // 1 CSS px あたりの画素数
  data: Buffer;
}

export async function shot(loc: Locator): Promise<Shot> {
  const buf = await loc.screenshot({ animations: "disabled", scale: "css" });
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, scale: 1, data: png.data };
}

export async function deviceShot(loc: Locator, scale: number): Promise<Shot> {
  const buf = await loc.screenshot({ animations: "disabled", scale: "device" });
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, scale, data: png.data };
}

export type RGB = [number, number, number];

export function px(s: Shot, x: number, y: number): RGB {
  const ix = Math.min(s.width - 1, Math.max(0, Math.round(x * s.scale)));
  const iy = Math.min(s.height - 1, Math.max(0, Math.round(y * s.scale)));
  const i = (iy * s.width + ix) * 4;
  return [s.data[i], s.data[i + 1], s.data[i + 2]];
}

export function near(a: RGB, b: RGB, tol = 40): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

export function hex(h: string): RGB {
  const s = h.replace("#", "");
  const f = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 色に近い画素の数・重心・外接矩形（CSS px）。 */
export function find(s: Shot, color: RGB, tol = 40, region?: Rect) {
  const r = region ?? { x: 0, y: 0, w: s.width / s.scale, h: s.height / s.scale };
  const x0 = Math.max(0, Math.floor(r.x * s.scale));
  const y0 = Math.max(0, Math.floor(r.y * s.scale));
  const x1 = Math.min(s.width, Math.ceil((r.x + r.w) * s.scale));
  const y1 = Math.min(s.height, Math.ceil((r.y + r.h) * s.scale));
  let n = 0, sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * s.width + x) * 4;
      if (Math.abs(s.data[i] - color[0]) <= tol && Math.abs(s.data[i + 1] - color[1]) <= tol && Math.abs(s.data[i + 2] - color[2]) <= tol) {
        n++;
        sx += x;
        sy += y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  const k = s.scale;
  return {
    count: n / (k * k),
    cx: n ? sx / n / k : NaN,
    cy: n ? sy / n / k : NaN,
    box: n ? { x: minX / k, y: minY / k, w: (maxX - minX + 1) / k, h: (maxY - minY + 1) / k } : null,
  };
}

/** 2 枚の差がある画素の割合。 */
export function diffRatio(a: Shot, b: Shot, tol = 16): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let d = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) d++;
  return d / (a.width * a.height);
}

/** 条件に合う画素の数・重心・外接矩形（CSS px）。 */
export function findWhere(s: Shot, pred: (r: number, g: number, b: number) => boolean, region?: Rect) {
  const r = region ?? { x: 0, y: 0, w: s.width / s.scale, h: s.height / s.scale };
  const x0 = Math.max(0, Math.floor(r.x * s.scale)), y0 = Math.max(0, Math.floor(r.y * s.scale));
  const x1 = Math.min(s.width, Math.ceil((r.x + r.w) * s.scale)), y1 = Math.min(s.height, Math.ceil((r.y + r.h) * s.scale));
  let n = 0, sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * s.width + x) * 4;
      if (pred(s.data[i], s.data[i + 1], s.data[i + 2])) {
        n++; sx += x; sy += y;
        if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
  const k = s.scale;
  return { count: n / (k * k), cx: n ? sx / n / k : NaN, cy: n ? sy / n / k : NaN, box: n ? { x: minX / k, y: minY / k, w: (maxX - minX + 1) / k, h: (maxY - minY + 1) / k } : null };
}

export const saturated = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b) > 120;
