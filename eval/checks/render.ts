// 描画方式の計測基板 render-v1 の判定（評価担当が凍結、docs/eval/render-v1.md）。画素の観測だけで判定する。作品の status は使わない。
// 制作担当には渡さない。期待値はこのファイルにだけ置く。物理は経路に依存しない性質だけを見る。
import { blob, components, EvalEnv, hex, scoreSquares, type Box, type CheckResult, type RGB, type Shot } from "../lib/env";

/** libraries は判定する作品が宣言したもの（候補の body.libraries。参照の作品は課題の libraries）。 */
export type RenderCheck = (env: EvalEnv, entry: string, libraries: string[] | undefined, seed: number) => Promise<CheckResult[]>;

const RED = hex("#ff0000"), GREEN = hex("#00ff00"), BLUE = hex("#0080ff"), WHITE = hex("#ffffff"), GRAY = hex("#808080"), CYAN = hex("#00ffff");
const YELLOW = hex("#ffff00"), PANEL = hex("#2050ff"), ORANGE = hex("#ff8000"), CUBE_BG = hex("#101020");

const res = (id: string, kind: CheckResult["kind"], pass: boolean, detail?: string): CheckResult => ({ id, kind, pass, detail });
const near = (a: number | undefined, b: number, tol: number) => a !== undefined && Number.isFinite(a) && Math.abs(a - b) <= tol;
const f1 = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? "NaN" : x.toFixed(1));
const bx = (b: { box: Box | null }) => (b.box ? `${b.box.x},${b.box.y},${b.box.w}x${b.box.h}` : "なし");

async function fresh(env: EvalEnv, entry: string, libraries: string[] | undefined, seed: number, id: string, kind: CheckResult["kind"], fn: () => Promise<[boolean, string?]>): Promise<CheckResult> {
  try {
    const r = await env.start(entry, null, seed, { libraries });
    if (r.type !== "ready") return res(id, kind, false, "起動しない: " + (r.message ?? r.type));
    const [ok, detail] = await fn();
    const errs = await env.collectErrors();
    if (errs.length) return res(id, kind, false, "実行時エラー: " + errs[0]);
    return res(id, kind, ok, detail);
  } catch (e) {
    return res(id, kind, false, "例外: " + (e as Error).message.slice(0, 200));
  } finally {
    await env.close();
  }
}

const lum = (s: Shot, x: number, y: number) => {
  const i = (y * s.w + x) * 4;
  return 0.2126 * s.data[i] + 0.7152 * s.data[i + 1] + 0.0722 * s.data[i + 2];
};
/** 画素の色が c に近いか。 */
const isColor = (s: Shot, x: number, y: number, c: RGB, tol: number) => {
  const i = (y * s.w + x) * 4;
  return Math.abs(s.data[i] - c[0]) <= tol && Math.abs(s.data[i + 1] - c[1]) <= tol && Math.abs(s.data[i + 2] - c[2]) <= tol;
};
/** 2 枚の写しで、領域の中の色 c の画素が食い違う数。 */
function maskDiff(a: Shot, b: Shot, c: RGB, r: Box, tol = 60) {
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isColor(a, x, y, c, tol) !== isColor(b, x, y, c, tol)) n++;
  return n;
}
/** 非同期の描画（decodeSVG など）が終わるまで、実時間で待ちながら少しずつ進めて条件を待つ。 */
async function until(env: EvalEnv, ok: (s: Shot) => boolean, ms = 2500): Promise<Shot> {
  const end = Date.now() + ms;
  let s = await env.shot();
  while (!ok(s) && Date.now() < end) {
    await env.page.waitForTimeout(50);
    await env.advance(16);
    s = await env.shot();
  }
  return s;
}

// =============== R-T1 Three.js の立方体 ===============
// 視野角 50 度・距離 5。正面の面（z = 0.8）の見かけの幅 = 1.6 / (2 × 4.2 × tan 25°) × 360 ≈ 147px。
// 45 度回ると縦の辺（x = ±1.131, z = 0）が輪郭になり ≈ 175px。90 度で正面に戻る。
const cube: RenderCheck = async (env, entry, libs, seed) => {
  const FACE = 147, DIAG = 175;
  const solid = (s: Shot, c: RGB) => blob(s, c, 60, { x: 60, y: 0, w: 360, h: 360 });
  return [
    await fresh(env, entry, libs, seed, "layout", "start", async () => {
      await env.advance(16);
      const s = await env.shot();
      const b = solid(s, RED);
      const bg = [[5, 5], [470, 5], [5, 350], [470, 350]].every(([x, y]) => isColor(s, x, y, CUBE_BG, 10));
      const ok = bg && !!b.box && near(b.cx, 240, 4) && near(b.cy, 180, 4) && near(b.box.w, FACE, 10) && near(b.box.h, FACE, 10);
      return [ok, `背景 ${bg} 赤 ${bx(b)} 中心 (${f1(b.cx)},${f1(b.cy)})`];
    }),
    await fresh(env, entry, libs, seed, "rotates-1rad-per-s", "retain", async () => {
      await env.advance(16);
      const w0 = solid(await env.shot(), RED).box?.w;
      await env.advance(Math.round((Math.PI / 4) * 1000) - 16);
      const w1 = solid(await env.shot(), RED).box?.w;
      await env.advance(Math.round((Math.PI / 4) * 1000));
      const w2 = solid(await env.shot(), RED).box?.w;
      const ok = near(w0, FACE, 10) && near(w1, DIAG, 12) && near(w2, w0 ?? NaN, 8);
      return [ok, `幅 0 秒 ${w0} π/4 秒 ${w1} π/2 秒 ${w2}`];
    }),
    await fresh(env, entry, libs, seed, "space-toggles-color", "retain", async () => {
      await env.advance(16);
      await env.press("Space");
      await env.advance(32);
      const s1 = await env.shot();
      await env.press("Space");
      await env.advance(32);
      const s2 = await env.shot();
      const g = solid(s1, GREEN), r1 = solid(s1, RED), r2 = solid(s2, RED);
      const ok = g.count > 10000 && r1.count < 200 && r2.count > 10000;
      return [ok, `1 回目 緑 ${g.count} 赤 ${r1.count}、2 回目 赤 ${r2.count}`];
    }),
    await fresh(env, entry, libs, seed, "click-blue", "retain", async () => {
      await env.advance(16);
      await env.click(20, 20);
      await env.advance(32);
      const a = await env.shot();
      await env.click(240, 180);
      await env.advance(32);
      const b = await env.shot();
      await env.press("Space");
      await env.advance(32);
      const c = await env.shot();
      const ok = solid(a, RED).count > 10000 && solid(a, BLUE).count < 200 && solid(b, BLUE).count > 10000 && solid(b, RED).count < 200 && solid(c, RED).count > 10000;
      return [ok, `背景クリック 赤 ${solid(a, RED).count}、立方体クリック 青 ${solid(b, BLUE).count}、Space 赤 ${solid(c, RED).count}`];
    }),
  ];
};

// =============== R-H1 HTML の得点パネル ===============
const panel: RenderCheck = async (env, entry, libs, seed) => {
  const P = { x: 40, y: 40, w: 240, h: 120 };
  const inside = { x: 42, y: 42, w: 236, h: 116 };
  const ready = (s: Shot) => blob(s, PANEL, 30, P).count > 8000;
  const readyO = (s: Shot) => blob(s, ORANGE, 30, P).count > 8000;
  return [
    await fresh(env, entry, libs, seed, "layout", "start", async () => {
      const s = await until(env, ready);
      const p = blob(s, PANEL, 30);
      const white = blob(s, WHITE, 60, { x: 40, y: 40, w: 240, h: 50 }).count;
      const yellow = blob(s, YELLOW, 60, { x: 40, y: 80, w: 240, h: 80 });
      let outside = 0;
      for (let y = 0; y < s.h; y += 2) for (let x = 0; x < s.w; x += 2) if ((x < 36 || x > 284 || y < 36 || y > 164) && lum(s, x, y) > 24) outside++;
      const ok = !!p.box && near(p.box.x, 40, 2) && near(p.box.y, 40, 2) && near(p.box.w, 240, 3) && near(p.box.h, 120, 3) && white >= 60 && yellow.count >= 60 && !!yellow.box && yellow.box.x <= 40 + 50 && outside < 20;
      return [ok, `パネル ${bx(p)} 白 ${white} 黄 ${yellow.count} ${bx(yellow)} 外の明るい画素 ${outside}`];
    }),
    await fresh(env, entry, libs, seed, "up-increments", "retain", async () => {
      const s0 = await until(env, ready);
      await env.press("ArrowUp");
      const s1 = await until(env, (s) => ready(s) && maskDiff(s0, s, YELLOW, inside) > 30);
      await env.press("ArrowUp");
      const s2 = await until(env, (s) => ready(s) && maskDiff(s1, s, YELLOW, inside) > 30);
      const d1 = maskDiff(s0, s1, YELLOW, inside), d2 = maskDiff(s1, s2, YELLOW, inside);
      const y1 = blob(s1, YELLOW, 60, P).count, y2 = blob(s2, YELLOW, 60, P).count;
      return [d1 > 30 && d2 > 30 && y1 >= 40 && y2 >= 40, `数字の画素の差 1 回目 ${d1} 2 回目 ${d2}（黄 ${y1}, ${y2}）`];
    }),
    await fresh(env, entry, libs, seed, "click-toggles", "retain", async () => {
      await until(env, ready);
      await env.click(400, 300);
      await env.page.waitForTimeout(300);
      await env.advance(16);
      const a = await env.shot();
      await env.click(160, 120);
      const b = await until(env, readyO);
      await env.click(160, 120);
      const c = await until(env, ready);
      const ok = ready(a) && readyO(b) && blob(b, PANEL, 30, P).count < 500 && ready(c);
      return [ok, `外クリック 青 ${blob(a, PANEL, 30, P).count}、中クリック 橙 ${blob(b, ORANGE, 30, P).count}、もう一度 青 ${blob(c, PANEL, 30, P).count}`];
    }),
  ];
};

// =============== R-P1 球の積み上げ ===============
const pile: RenderCheck = async (env, entry, libs, seed) => {
  const FLOOR = 340, R = 12;
  const field = { x: 20, y: 0, w: 440, h: FLOOR };
  const whites = (s: Shot) => blob(s, WHITE, 60, field);
  const strayWhite = (s: Shot) => blob(s, WHITE, 60, { x: 0, y: FLOOR + 2, w: 480, h: 18 }).count + blob(s, WHITE, 60, { x: 0, y: 0, w: 18, h: 360 }).count + blob(s, WHITE, 60, { x: 462, y: 0, w: 18, h: 360 }).count;
  /** 1 個だけ落として止まった球の面積（同じ作品の画素で数える）。 */
  const oneBall = async () => {
    await env.click(240, 200);
    await env.advance(2000);
    return whites(await env.shot()).count;
  };
  return [
    await fresh(env, entry, libs, seed, "layout", "start", async () => {
      await env.advance(16);
      const s = await env.shot();
      const floor = blob(s, GRAY, 20, { x: 20, y: 320, w: 440, h: 40 });
      const left = blob(s, GRAY, 20, { x: 0, y: 0, w: 40, h: 320 }), right = blob(s, GRAY, 20, { x: 440, y: 0, w: 40, h: 320 });
      const ok = !!floor.box && near(floor.box.y, FLOOR, 2) && near(floor.box.h, 20, 2) && floor.box.w >= 438 && !!left.box && near(left.box.w, 20, 2) && left.count > 20 * 300 && !!right.box && near(right.box.x, 460, 2) && right.count > 20 * 300 && whites(s).count === 0;
      return [ok, `床 ${bx(floor)} 左 ${bx(left)} 右 ${bx(right)} 白 ${whites(s).count}`];
    }),
    await fresh(env, entry, libs, seed, "drop-and-rest", "retain", async () => {
      await env.advance(16);
      await env.click(240, 200);
      await env.advance(16);
      const a = whites(await env.shot());
      await env.advance(1500);
      const b = whites(await env.shot());
      await env.advance(500);
      const c = whites(await env.shot());
      const area = Math.PI * R * R;
      const ok = near(a.cx, 240, 4) && near(a.cy, 40, 5) && near(b.cx, 240, 4) && near(b.cy, FLOOR - R, 3) && near(c.cy, b.cy, 1) && near(c.cx, b.cx, 1) && near(c.count, area, area * 0.35);
      return [ok, `出た位置 (${f1(a.cx)},${f1(a.cy)}) 1.5 秒 (${f1(b.cx)},${f1(b.cy)}) 2 秒 (${f1(c.cx)},${f1(c.cy)}) 面積 ${c.count}`];
    }),
    await fresh(env, entry, libs, seed, "stack-no-overlap", "retain", async () => {
      await env.advance(16);
      const one = await oneBall();
      for (let i = 1; i < 10; i++) {
        await env.click(i % 2 ? 236 : 244, 200);
        await env.advance(400);
      }
      await env.advance(3000);
      const s = await env.shot();
      const n = whites(s).count / one, stray = strayWhite(s);
      await env.advance(0);
      await env.advance(0);
      const s2 = await env.shot();
      const still = maskDiff(s, s2, WHITE, field) === 0;
      return [one > 0 && n >= 9.3 && n <= 10.5 && stray === 0 && still, `1 個の面積 ${one}、10 個の面積 = ${n.toFixed(2)} 個分、壁・床の白 ${stray}、advance(0) で不動 ${still}`];
    }),
    await fresh(env, entry, libs, seed, "max-30-and-reset", "retain", async () => {
      await env.advance(16);
      const one = await oneBall();
      for (let i = 1; i < 36; i++) {
        await env.click(40 + ((i * 53) % 400), 200);
        await env.advance(150);
      }
      await env.advance(4000);
      const s = await env.shot();
      const n = whites(s).count / one;
      await env.press("KeyR");
      await env.advance(32);
      const r = whites(await env.shot()).count;
      return [one > 0 && n >= 27 && n <= 31 && strayWhite(s) === 0 && r === 0, `36 回クリックで ${n.toFixed(1)} 個分、壁・床の白 ${strayWhite(s)}、R の後の白 ${r}`];
    }),
  ];
};

// =============== R-P2 marble run ===============
const lineY = (x1: number, y1: number, x2: number, y2: number) => (x: number) => y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
const A = lineY(20, 90, 380, 190), B = lineY(460, 230, 100, 330);
const marbles: RenderCheck = async (env, entry, libs, seed) => {
  const R = 8, AREA = Math.PI * R * R;
  const whites = (s: Shot, r?: Box) => blob(s, WHITE, 60, r);
  /** 経路が分かれても成り立たない場所（すり抜けの跡）にある白の画素。 */
  const tunnel = (s: Shot) => {
    let n = 0;
    for (let x = 0; x < 480; x++)
      for (let y = 0; y < 360; y++) {
        if (!isColor(s, x, y, WHITE, 60)) continue;
        const bad = y > 354 || x < 16 || x > 464 || (x < 110 && y > A(x) + 6 && y < 300) || (x >= 110 && x <= 370 && y > A(x) + 6 && y < B(x) - 40) || (x >= 110 && x <= 450 && y > B(x) + 6);
        if (bad) n++;
      }
    return n;
  };
  const bin = { x: 22, y: 240, w: 88, h: 108 };
  return [
    await fresh(env, entry, libs, seed, "layout", "start", async () => {
      await env.advance(16);
      const s = await env.shot();
      const onA = [0.1, 0.3, 0.5, 0.7, 0.9].every((t) => { const x = Math.round(20 + 360 * t); return isColor(s, x, Math.round(A(x)), CYAN, 40); });
      const onB = [0.1, 0.3, 0.5, 0.7, 0.9].every((t) => { const x = Math.round(460 - 360 * t); return isColor(s, x, Math.round(B(x)), CYAN, 40); });
      const walls = [100, 200, 300, 340].every((y) => isColor(s, 20, y, GRAY, 30) && isColor(s, 460, y, GRAY, 30)) && !isColor(s, 20, 30, GRAY, 30);
      const floor = [40, 200, 440].every((x) => isColor(s, x, 350, GRAY, 30));
      const m = whites(s);
      const ok = onA && onB && walls && floor && near(m.cx, 40, 3) && near(m.cy, 60, 4) && near(m.count, AREA, AREA * 0.4);
      return [ok, `坂 A ${onA} 坂 B ${onB} 壁 ${walls} 床 ${floor} 玉 (${f1(m.cx)},${f1(m.cy)}) 面積 ${m.count}`];
    }),
    await fresh(env, entry, libs, seed, "rolls-down-ramp-a", "retain", async () => {
      await env.advance(900);
      const s = await env.shot();
      const ms = components(s, WHITE, 60, undefined, 20);
      const m = ms.sort((a, b) => b.cx - a.cx)[0];
      // 坂 A の上に載っている玉の中心は、線の中心から 4 + 8 = 12px 上（傾き 15.5 度で縦には 12.5px）
      const ok = !!m && m.cx > 70 && m.cx < 380 && near(A(m.cx) - m.cy, 12.5, 4);
      return [ok, m ? `0.9 秒 (${f1(m.cx)},${f1(m.cy)}) 線からの高さ ${f1(A(m.cx) - m.cy)}` : "玉が見つからない"];
    }),
    await fresh(env, entry, libs, seed, "collect-in-bin-no-tunnel", "retain", async () => {
      let worst = 0;
      for (let t = 0; t < 12000; t += 250) {
        await env.advance(250);
        worst = Math.max(worst, tunnel(await env.shot()));
      }
      const s = await env.shot();
      const n = whites(s, bin).count / AREA;
      const total = whites(s).count / AREA;
      return [n >= 4 && worst === 0 && total >= 8.5, `12 秒で箱に ${n.toFixed(1)} 個分（全体 ${total.toFixed(1)} 個分）、すり抜けの跡 ${worst} 画素`];
    }),
    await fresh(env, entry, libs, seed, "space-adds", "retain", async () => {
      await env.advance(600);
      const a = whites(await env.shot()).count / AREA;
      await env.press("Space");
      await env.advance(200);
      const b = whites(await env.shot()).count / AREA;
      return [near(a, 1, 0.4) && near(b, 2, 0.5), `Space の前 ${a.toFixed(2)} 個分、後 ${b.toFixed(2)} 個分`];
    }),
  ];
};

// =============== R-P3 フリッパー ===============
const flipper: RenderCheck = async (env, entry, libs, seed) => {
  const c30 = Math.cos(Math.PI / 6) * 50, s30 = Math.sin(Math.PI / 6) * 50;
  const red = (s: Shot) => blob(s, RED, 60, { x: 100, y: 200, w: 200, h: 160 });
  const ball = (s: Shot) => components(s, WHITE, 60, { x: 20, y: 0, w: 440, h: 360 }, 20)[0];
  return [
    await fresh(env, entry, libs, seed, "layout", "start", async () => {
      await env.advance(16);
      const s = await env.shot();
      const f = red(s), b = ball(s);
      const walls = isColor(s, 10, 180, GRAY, 30) && isColor(s, 470, 180, GRAY, 30);
      const ok = walls && !!f.box && near(f.cx, 150 + c30, 4) && near(f.cy, 300 + s30, 4) && near(f.box.w, 93.6, 6) && near(f.box.h, 62.1, 6) && !!b && near(b.cx, 230, 3) && near(b.cy, 40, 4);
      return [ok, `壁 ${walls} フリッパー ${bx(f)} 重心 (${f1(f.cx)},${f1(f.cy)}) 球 ${b ? `(${f1(b.cx)},${f1(b.cy)})` : "なし"}`];
    }),
    await fresh(env, entry, libs, seed, "flipper-up-and-back", "retain", async () => {
      await env.advance(16);
      await env.down("ArrowLeft");
      await env.advance(150);
      const up = red(await env.shot());
      await env.up("ArrowLeft");
      await env.advance(150);
      const down = red(await env.shot());
      const ok = near(up.cx, 150 + c30, 4) && near(up.cy, 300 - s30, 4) && near(down.cx, 150 + c30, 4) && near(down.cy, 300 + s30, 4);
      return [ok, `押して 0.15 秒 (${f1(up.cx)},${f1(up.cy)}) 離して 0.15 秒 (${f1(down.cx)},${f1(down.cy)})`];
    }),
    await fresh(env, entry, libs, seed, "drain-and-respawn", "retain", async () => {
      let maxY = 0, firstDrain = -1;
      for (let t = 0; t < 4000; t += 50) {
        await env.advance(50);
        const s = await env.shot();
        const b = ball(s);
        if (b && firstDrain < 0) maxY = Math.max(maxY, b.cy);
        if (firstDrain < 0 && scoreSquares(s) === 1) {
          firstDrain = t + 50;
          if (!b || b.cy > 90) return [false, `数が増えた時に球が上にない ${b ? f1(b.cy) : "なし"}`];
        }
      }
      const s = await env.shot();
      const sq = components(s, YELLOW, 40, { x: 0, y: 0, w: 480, h: 16 }, 30).sort((a, b) => a.cx - b.cx);
      const ok = firstDrain > 0 && maxY > 270 && sq.length === 2 && near(sq[0].box!.x, 8, 2) && near(sq[0].box!.y, 4, 2) && near(sq[1].cx - sq[0].cx, 12, 1.5);
      return [ok, `最初の落とし直し ${firstDrain}ms、それまでの最低位置 ${f1(maxY)}、4 秒で四角 ${sq.length} 個 ${sq.map((q) => bx(q)).join(" ")}`];
    }),
    await fresh(env, entry, libs, seed, "flip-launches-ball", "retain", async () => {
      // 球が下りてきてフリッパーの先の少し上（y ≥ 255）に来た時点で←を押す。経路は見ない（上へ飛ぶかだけ）
      let pressed = -1;
      for (let t = 0; t < 2000 && pressed < 0; t += 16) {
        await env.advance(16);
        const b = ball(await env.shot());
        if (b && b.cy >= 255) { await env.down("ArrowLeft"); pressed = t; }
      }
      if (pressed < 0) return [false, "球が下りてこない"];
      let minY = 999;
      for (let t = 0; t < 800; t += 32) {
        await env.advance(32);
        const s = await env.shot();
        const b = ball(s);
        if (b && scoreSquares(s) === 0) minY = Math.min(minY, b.cy);
      }
      await env.up("ArrowLeft");
      return [minY < 180, `←を押した時刻 ${pressed}ms、その後の最高位置 y=${f1(minY)}`];
    }),
  ];
};

// =============== R-V1 ブラックホール ===============
const blackhole: RenderCheck = async (env, entry, libs, seed) => {
  const CX = 240, CY = 180, H = 360;
  const meanLum = (s: Shot, r: Box) => {
    let n = 0, sum = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { sum += lum(s, x, y); n++; }
    return sum / n;
  };
  /** 中心から上へ、最初に明るくなる距離（影の半径の目安）。 */
  const shadowUp = (s: Shot) => {
    for (let d = 0; d < 170; d++) if (lum(s, CX, CY - d) > 60) return d;
    return NaN;
  };
  /** 明るい画素（輝度 80 超）が 3 個以上ある行の数（縦の広がり）。 */
  const brightRows = (s: Shot) => {
    let rows = 0;
    for (let y = 0; y < s.h; y++) {
      let n = 0;
      for (let x = 0; x < s.w; x += 2) if (lum(s, x, y) > 80) n++;
      if (n >= 3) rows++;
    }
    return rows;
  };
  const brightIn = (s: Shot, r: Box, th = 80) => {
    let n = 0;
    for (let y = Math.max(0, r.y); y < Math.min(s.h, r.y + r.h); y++) for (let x = r.x; x < r.x + r.w; x++) if (lum(s, x, y) > th) n++;
    return n;
  };
  return [
    await fresh(env, entry, libs, seed, "shadow-ring-lensed-arc-stars", "start", async () => {
      await env.advance(100);
      const s = await env.shot();
      const core = meanLum(s, { x: CX - 6, y: CY - 6, w: 12, h: 12 });
      const r = shadowUp(s);
      const ring = brightIn(s, { x: CX - 170, y: CY - 120, w: 340, h: 240 });
      const arc = Number.isFinite(r) ? brightIn(s, { x: CX - 50, y: Math.round(CY - r - 25), w: 100, h: 25 }, 60) : 0;
      // 星：円盤から離れた上下の帯（高さ 70px）で、3px 離れた周りより輝度が 10 以上高い極大の点
      let stars = 0;
      for (const y0 of [0, 290])
        for (let y = y0 + 3; y < y0 + 67; y++)
          for (let x = 3; x < 477; x++) {
            const l = lum(s, x, y);
            const bg = (lum(s, x - 3, y) + lum(s, x + 3, y) + lum(s, x, y - 3) + lum(s, x, y + 3)) / 4;
            if (l > bg + 10 && l >= lum(s, x - 1, y) && l >= lum(s, x + 1, y) && l >= lum(s, x, y - 1) && l >= lum(s, x, y + 1)) stars++;
          }
      const ok = core < 12 && r >= 0.1 * H && r <= 0.3 * H && ring >= 3000 && arc >= 300 && stars >= 3;
      return [ok, `中心の輝度 ${f1(core)}、影の半径（上） ${r}px（高さの ${f1((r / H) * 100)}%）、明るい画素 ${ring}、影の上の弧 ${arc}、星 ${stars}`];
    }),
    await fresh(env, entry, libs, seed, "disk-animates", "retain", async () => {
      await env.advance(100);
      const a = await env.shot();
      await env.advance(1000);
      const b = await env.shot();
      let n = 0;
      for (let y = CY - 120; y < CY + 120; y++) for (let x = CX - 170; x < CX + 170; x++) if (Math.abs(lum(a, x, y) - lum(b, x, y)) > 4) n++;
      return [n >= 3000, `1 秒で輝度が 4 より大きく変わった画素 ${n}（影の周りの 340×240）`];
    }),
    await fresh(env, entry, libs, seed, "keys-change-inclination", "retain", async () => {
      await env.advance(100);
      const r0 = brightRows(await env.shot());
      await env.down("ArrowUp");
      await env.advance(1500);
      await env.up("ArrowUp");
      await env.advance(16);
      const r1 = brightRows(await env.shot());
      await env.down("ArrowDown");
      await env.advance(1500);
      await env.up("ArrowDown");
      await env.advance(16);
      const r2 = brightRows(await env.shot());
      return [r0 >= 20 && r1 >= r0 * 1.15 && r2 <= r1 * 0.87, `明るい行の数 最初 ${r0}、↑ 1.5 秒 ${r1}、↓ 1.5 秒 ${r2}`];
    }),
    await fresh(env, entry, libs, seed, "advance-1s-under-8s", "retain", async () => {
      await env.advance(100); // シェーダーの準備（最初のコンパイル）を除く
      const t0 = Date.now();
      await env.advance(1000);
      const ms = Date.now() - t0;
      const s = await env.shot();
      return [ms <= 8000 && meanLum(s, { x: 0, y: 0, w: 480, h: 360 }) > 3, `advance(1000) の壁時計 ${ms}ms`];
    }),
  ];
};

export const RENDER_CHECKS: Record<string, RenderCheck> = {
  "R-T1-cube": cube,
  "R-H1-panel": panel,
  "R-P1-pile": pile,
  "R-P2-marbles": marbles,
  "R-P3-flipper": flipper,
  "R-V1-blackhole": blackhole,
};
