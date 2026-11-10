// 画面写しの画素の道具（推論を使わない）。性質の観測（host-probe）と検証担当の台本の実行が共通で使う。
// 評価側の画素の道具（eval/lib/env.ts）は凍結なので、ここに別に持つ（src/ から eval/ を import しない）。
// α は比べない（画面写しの α は常に 255）。

export interface Shot { width: number; height: number; data: Uint8Array } // RGBA、1 画素 4 バイト
export interface Box { x: number; y: number; w: number; h: number }
export interface DiffResult { pixels: number; box: Box | null }
export interface SceneItem { color: string; box: Box; area: number } // color は "#rrggbb"
export interface Scene { width: number; height: number; background: string; items: SceneItem[]; omitted: number }
export interface BlobResult { pixels: number; box: Box | null; cx: number | null; cy: number | null }

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

export function rgbHex(r: number, g: number, b: number): string {
  return "#" + hex2(r & 255) + hex2(g & 255) + hex2(b & 255);
}

export function parseHex(h: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(h));
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** 外接矩形を広げながら数える小さな道具。 */
function boxer() {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  return {
    add(x: number, y: number) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    },
    box(): Box | null {
      return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    },
  };
}

/** RGB のどれかが違う画素の数と外接矩形。寸法が違えば全面が違うとみなす。 */
export function diffShots(a: Shot, b: Shot): DiffResult {
  if (a.width !== b.width || a.height !== b.height) return { pixels: a.width * a.height, box: { x: 0, y: 0, w: a.width, h: a.height } };
  let pixels = 0;
  const bx = boxer();
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
        pixels++;
        bx.add(x, y);
      }
    }
  return { pixels, box: pixels ? bx.box() : null };
}

/** 最も多い色（0xRRGGBB）。全画素を数える。同数なら数値の小さい色。 */
export function dominantColor(s: Shot): number {
  const counts = new Map<number, number>();
  const n = s.width * s.height;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const c = (s.data[i] << 16) | (s.data[i + 1] << 8) | s.data[i + 2];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best = 0, bestN = -1;
  for (const [c, k] of counts) if (k > bestN || (k === bestN && c < best)) { best = c; bestN = k; }
  return best;
}

export function isSingleColor(s: Shot): boolean {
  const d = s.data;
  const n = s.width * s.height;
  for (let p = 1; p < n; p++) {
    const i = p * 4;
    if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return false;
  }
  return true;
}

/** 各チャンネルの差が tol 以下の画素の数・外接矩形・重心（小数 1 桁）。 */
export function blobOf(s: Shot, color: number, tol = 30): BlobResult {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  let pixels = 0, sx = 0, sy = 0;
  const bx = boxer();
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++) {
      const i = (y * s.width + x) * 4;
      if (Math.abs(s.data[i] - r) <= tol && Math.abs(s.data[i + 1] - g) <= tol && Math.abs(s.data[i + 2] - b) <= tol) {
        pixels++;
        sx += x;
        sy += y;
        bx.add(x, y);
      }
    }
  if (!pixels) return { pixels: 0, box: null, cx: null, cy: null };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { pixels, box: bx.box(), cx: r1(sx / pixels), cy: r1(sy / pixels) };
}

/**
 * 画面の要約：背景（最も多い色）から離れた画素を、色の鍵（各チャンネルの上位 3 ビット）が同じで上下左右に隣り合うまとまりにする。
 * 画素単位で行う（升目にまとめると少数派の色の画素が欠け、面積と外接矩形がずれる）。
 */
export function describeScene(s: Shot, maxItems = 24): Scene {
  const W = s.width, H = s.height, d = s.data;
  const bg = dominantColor(s);
  const br = (bg >> 16) & 255, bgG = (bg >> 8) & 255, bb = bg & 255;
  const n = W * H;
  const key = new Int16Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    key[p] = Math.abs(r - br) > 24 || Math.abs(g - bgG) > 24 || Math.abs(b - bb) > 24 ? ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5) : -1;
  }
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const items: SceneItem[] = [];
  let small = 0;
  for (let start = 0; start < n; start++) {
    if (seen[start] || key[start] < 0) continue;
    const k = key[start];
    let top = 0, area = 0;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const colors = new Map<number, number>();
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const p = stack[--top];
      const x = p % W, y = (p - x) / W;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const i = p * 4;
      const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      colors.set(c, (colors.get(c) ?? 0) + 1);
      if (x > 0 && !seen[p - 1] && key[p - 1] === k) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < W - 1 && !seen[p + 1] && key[p + 1] === k) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (y > 0 && !seen[p - W] && key[p - W] === k) { seen[p - W] = 1; stack[top++] = p - W; }
      if (y < H - 1 && !seen[p + W] && key[p + W] === k) { seen[p + W] = 1; stack[top++] = p + W; }
    }
    if (area < 4) { small++; continue; }
    let rep = 0, repN = -1;
    for (const [c, m] of colors) if (m > repN || (m === repN && c < rep)) { rep = c; repN = m; }
    items.push({ color: rgbHex(rep >> 16, rep >> 8, rep), box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, area });
  }
  items.sort((a, b) => b.area - a.area || a.box.y - b.box.y || a.box.x - b.box.x);
  const kept = items.slice(0, maxItems);
  return { width: W, height: H, background: rgbHex(bg >> 16, bg >> 8, bg), items: kept, omitted: items.length - kept.length + small };
}

/** 画面の要約を 1 行の文にする。 */
export function sceneText(scene: Scene): string {
  let t = `画面 ${scene.width}×${scene.height}、背景 ${scene.background}。要素 ${scene.items.length} 個`;
  if (scene.omitted >= 1) t += `（ほかに小さい要素 ${scene.omitted} 個を省略）`;
  if (scene.items.length) t += "：" + scene.items.map((i) => `${i.color} 左上(${i.box.x},${i.box.y}) 幅${i.box.w} 高さ${i.box.h} 画素${i.area}`).join(" / ");
  return t;
}
