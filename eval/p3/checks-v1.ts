// 判定 v1（P2 で凍結した commit 0edd712 の eval/checks/heldout.ts をそのまま固定。P3 の正式な判定）。

// 未使用課題の判定（評価担当が凍結）。画素の観測だけで判定する。作品の status は使わない。
import { blob, components, EvalEnv, hex, isGameOver, scoreSquares, type CheckResult, type Shot } from "../lib/env";

type Check = (env: EvalEnv, entry: string, data: unknown, seed: number) => Promise<CheckResult[]>;

const GREEN = hex("#00ff00"), RED = hex("#ff0000"), WHITE = hex("#ffffff"), CYAN = hex("#00ffff");

function res(id: string, kind: CheckResult["kind"], pass: boolean, detail?: string): CheckResult {
  return { id, kind, pass, detail };
}
const near = (a: number, b: number, tol: number) => Number.isFinite(a) && Math.abs(a - b) <= tol;

async function boot(env: EvalEnv, entry: string, data: unknown, seed: number, o: { narrow?: boolean } = {}) {
  const r = await env.start(entry, data, seed, o);
  return r.type === "ready";
}

/** 1 つの観点を新しいセッションで試す。例外・起動失敗は不合格。 */
async function fresh(env: EvalEnv, entry: string, data: unknown, seed: number, id: string, kind: CheckResult["kind"], fn: () => Promise<[boolean, string?]>, o: { narrow?: boolean } = {}): Promise<CheckResult> {
  try {
    if (!(await boot(env, entry, data, seed, o))) return res(id, kind, false, "起動しない");
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

// ---------- 新規 ----------
const runner: Check = async (env, entry, data, seed) => {
  const H = 360;
  const out: CheckResult[] = [];
  out.push(await fresh(env, entry, data, seed, "start-player-on-ground", "start", async () => {
    const p = blob(await env.shot(), GREEN);
    if (!p.box) return [false, "自機なし"];
    return [near(p.cx, 70, 15) && near(p.box.y + p.box.h, H - 40, 6) && near(p.box.w, 20, 3), `cx=${p.cx.toFixed(1)} bottom=${p.box.y + p.box.h}`];
  }));
  out.push(await fresh(env, entry, data, seed, "obstacle-moves-left-200", "start", async () => {
    let r = null;
    for (let i = 0; i < 40 && !r; i++) {
      await env.advance(100);
      const c = components(await env.shot(), RED, 30).filter((b) => b.cx > 240);
      if (c.length) r = c[0];
    }
    if (!r) return [false, "障害物が出ない"];
    await env.advance(200);
    const c2 = components(await env.shot(), RED, 30).sort((a, b) => Math.abs(a.cx - r!.cx) - Math.abs(b.cx - r!.cx))[0];
    const dx = r.cx - (c2?.cx ?? NaN);
    return [near(dx, 40, 12) && near(r.box!.h, 30, 4), `dx=${dx.toFixed(1)} h=${r.box!.h}`];
  }));
  out.push(await fresh(env, entry, data, seed, "jump-space", "retain", async () => {
    await env.advance(50);
    const y0 = blob(await env.shot(), GREEN).cy;
    await env.press("Space");
    await env.advance(300);
    const y1 = blob(await env.shot(), GREEN).cy;
    await env.advance(1500);
    const y2 = blob(await env.shot(), GREEN).cy;
    return [y0 - y1 >= 30 && near(y2, y0, 3), `y0=${y0.toFixed(1)} y1=${y1.toFixed(1)} y2=${y2.toFixed(1)}`];
  }));
  out.push(await fresh(env, entry, data, seed, "score-by-jumping", "retain", async () => {
    const ground = blob(await env.shot(), GREEN).cy;
    let best = 0;
    for (let t = 0; t < 14000; t += 48) {
      const s = await env.shot();
      if (isGameOver(s)) return [false, `ゲームオーバー（得点 ${best}）`];
      best = Math.max(best, scoreSquares(s));
      if (best >= 2) return [true, `得点 ${best}`];
      const p = blob(s, GREEN);
      if (p.box && near(p.cy, ground, 2)) {
        const right = p.box.x + p.box.w;
        const obs = components(s, RED, 30).filter((b) => b.box!.x + b.box!.w > p.box!.x);
        const gap = Math.min(...obs.map((b) => b.box!.x - right));
        if (gap > 25 && gap <= 60) await env.press("Space");
      }
      await env.advance(48);
    }
    return [false, `得点 ${best}`];
  }));
  out.push(await fresh(env, entry, data, seed, "collision-gameover-restart", "retain", async () => {
    let over = false;
    for (let i = 0; i < 24 && !over; i++) {
      await env.advance(500);
      over = isGameOver(await env.shot());
    }
    if (!over) return [false, "当たってもゲームオーバーにならない"];
    await env.press("KeyR");
    await env.advance(50);
    const s = await env.shot();
    return [!isGameOver(s) && scoreSquares(s) === 0 && blob(s, GREEN).count > 200, "再開後"];
  }));
  return out;
};

const coins: Check = async (env, entry, data, seed) => {
  const out: CheckResult[] = [];
  out.push(await fresh(env, entry, data, seed, "arrow-move-200", "start", async () => {
    const a = blob(await env.shot(), GREEN);
    await env.hold("ArrowRight", 300);
    const b = blob(await env.shot(), GREEN);
    await env.hold("ArrowDown", 200);
    const c = blob(await env.shot(), GREEN);
    return [near(b.cx - a.cx, 60, 15) && near(c.cy - b.cy, 40, 12) && near(a.box?.w ?? 0, 20, 3), `dx=${(b.cx - a.cx).toFixed(1)} dy=${(c.cy - b.cy).toFixed(1)}`];
  }));
  out.push(await fresh(env, entry, data, seed, "collect-coins-timer-restart", "retain", async () => {
    let score = 0;
    while (env.t < 14000 && score < 3) {
      const s = await env.shot();
      score = scoreSquares(s);
      const p = blob(s, GREEN), c = blob(s, CYAN, 30, { x: 0, y: 20, w: s.w, h: s.h - 30 });
      if (!p.box || !c.box) { await env.advance(50); continue; }
      const dx = c.cx - p.cx, dy = c.cy - p.cy;
      const key = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "ArrowRight" : "ArrowLeft") : dy > 0 ? "ArrowDown" : "ArrowUp";
      const ms = Math.max(16, Math.min(300, (Math.max(Math.abs(dx), Math.abs(dy)) / 0.2) * 0.8));
      await env.hold(key, Math.round(ms));
    }
    if (score < 3) return [false, `14 秒で得点 ${score}`];
    await env.advance(Math.max(0, 10000 - env.t));
    if (env.t <= 10000) {
      const bar = blob(await env.shot(), WHITE, 20, { x: 0, y: 360 - 8, w: 480, h: 8 });
      if (!bar.box || !near(bar.box.w / 480, (20000 - env.t) / 20000, 0.06)) return [false, `残り時間バー ${bar.box?.w}`];
    }
    await env.advance(19500 - env.t);
    if (isGameOver(await env.shot())) return [false, "19.5 秒で終了"];
    await env.advance(1000);
    if (!isGameOver(await env.shot())) return [false, "20.5 秒で終わらない"];
    await env.press("KeyR");
    await env.advance(50);
    const s = await env.shot();
    return [!isGameOver(s) && scoreSquares(s) === 0, "再開"];
  }));
  return out;
};

const shooter: Check = async (env, entry, data, seed) => {
  const out: CheckResult[] = [];
  const H = 360;
  out.push(await fresh(env, entry, data, seed, "move-and-fire", "start", async () => {
    const a = blob(await env.shot(), GREEN);
    await env.hold("ArrowLeft", 200);
    const b = blob(await env.shot(), GREEN);
    await env.press("Space");
    await env.advance(100);
    const bl1 = blob(await env.shot(), WHITE, 30, { x: 0, y: 20, w: 480, h: b.box ? b.box.y - 20 : 300 });
    await env.advance(100);
    const bl2 = blob(await env.shot(), WHITE, 30, { x: 0, y: 20, w: 480, h: b.box ? b.box.y - 20 : 300 });
    const ok = near(a.cx - b.cx, 50, 12) && near(a.box?.w ?? 0, 30, 3) && near((a.box?.y ?? 0) + (a.box?.h ?? 0), H - 30, 8) && bl1.box !== null && near(bl1.cy - bl2.cy, 40, 12) && near(bl1.cx, b.cx, 4);
    return [ok, `dx=${(a.cx - b.cx).toFixed(1)} bullet=${bl1.box ? bl1.cy.toFixed(0) + "→" + bl2.cy.toFixed(0) : "なし"}`];
  }));
  out.push(await fresh(env, entry, data, seed, "hit-then-ammo-gameover-restart", "retain", async () => {
    let presses = 0, prev: { cx: number } | null = null, score = 0;
    const p0 = blob(await env.shot(), GREEN);
    if (!p0.box) return [false, "自機なし"];
    while (env.t < 8000 && score < 1 && presses < 5) {
      const s = await env.shot();
      score = scoreSquares(s);
      const e = blob(s, RED, 30), bul = blob(s, WHITE, 30, { x: 0, y: 20, w: 480, h: p0.box!.y - 20 });
      if (e.box && prev && !bul.box) {
        const vx = (e.cx - prev.cx) / 16;
        const T = (p0.box!.y - e.cy) / 0.4;
        const pred = e.cx + vx * T;
        if (Math.abs(pred - p0.cx) < 8 && pred > 20 && pred < 460) {
          await env.press("Space");
          presses++;
          await env.advance(Math.ceil(T) + 100);
          score = scoreSquares(await env.shot());
          prev = null;
          continue;
        }
      }
      prev = e.box ? { cx: e.cx } : null;
      await env.advance(16);
    }
    if (score < 1) return [false, `${presses} 発で命中なし`];
    while (presses < 9) {
      await env.press("Space");
      presses++;
      await env.advance(1000);
      if (isGameOver(await env.shot())) return [false, `${presses} 発目でゲームオーバー`];
    }
    await env.press("Space");
    await env.advance(1200);
    if (!isGameOver(await env.shot())) return [false, "10 発撃ってもゲームオーバーにならない"];
    await env.press("KeyR");
    await env.advance(50);
    const s = await env.shot();
    return [!isGameOver(s) && scoreSquares(s) === 0, `命中後の再開`];
  }));
  return out;
};

const ORANGE = hex("#ff8000");
const catchGame: Check = async (env, entry, data, seed) => {
  const out: CheckResult[] = [];
  out.push(await fresh(env, entry, data, seed, "basket-follows-pointer", "start", async () => {
    await env.pointer(100, 300);
    await env.advance(16);
    const a = blob(await env.shot(), GREEN);
    await env.pointer(300, 300);
    await env.advance(16);
    const b = blob(await env.shot(), GREEN);
    return [near(a.cx, 100, 4) && near(b.cx, 300, 4) && near(b.box?.w ?? 0, 80, 3) && near((b.box?.y ?? 0) + (b.box?.h ?? 0), 330, 6), `a=${a.cx.toFixed(1)} b=${b.cx.toFixed(1)}`];
  }));
  out.push(await fresh(env, entry, data, seed, "catch-miss-gameover-restart", "retain", async () => {
    let score = 0;
    while (env.t < 15000 && score < 3) {
      const s = await env.shot();
      score = scoreSquares(s);
      const f = blob(s, ORANGE, 30);
      if (f.box) await env.pointer(Math.max(40, Math.min(440, f.cx)), 300);
      await env.advance(100);
    }
    if (score < 3) return [false, `受け止め ${score}`];
    const t0 = env.t;
    while (env.t - t0 < 20000) {
      const s = await env.shot();
      if (isGameOver(s)) break;
      const f = blob(s, ORANGE, 30);
      if (f.box) await env.pointer(f.cx < 240 ? 440 : 40, 300);
      await env.advance(200);
    }
    const s1 = await env.shot();
    if (!isGameOver(s1)) return [false, "取り逃してもゲームオーバーにならない"];
    await env.click(240, 200);
    await env.advance(50);
    const s2 = await env.shot();
    return [!isGameOver(s2) && scoreSquares(s2) === 0, "再開"];
  }));
  return out;
};

// ---------- スネーク共通 ----------
const HEAD = hex("#80ff80"), BODY = hex("#00c000");
async function snakeCell(env: EvalEnv) {
  const h = blob(await env.shot(), HEAD, 20);
  return h.box ? h.box.w + 2 : NaN;
}
async function headMoveCells(env: EvalEnv, ms: number) {
  const cell = await snakeCell(env);
  const a = blob(await env.shot(), HEAD, 20);
  await env.advance(ms);
  const b = blob(await env.shot(), HEAD, 20);
  return { cells: (Math.abs(b.cx - a.cx) + Math.abs(b.cy - a.cy)) / cell, cell };
}
async function steerToFood(env: EvalEnv, maxMs: number, target: number) {
  const t0 = env.t;
  let lastKey = "", heading = "ArrowRight", prev: { cx: number; cy: number } | null = null;
  const opposite: Record<string, string> = { ArrowRight: "ArrowLeft", ArrowLeft: "ArrowRight", ArrowUp: "ArrowDown", ArrowDown: "ArrowUp" };
  while (env.t - t0 < maxMs) {
    const s = await env.shot();
    if (isGameOver(s)) return { score: scoreSquares(s), over: true };
    if (scoreSquares(s) >= target) return { score: scoreSquares(s), over: false };
    const h = blob(s, HEAD, 20), f = blob(s, RED, 20, { x: 0, y: 16, w: s.w, h: s.h - 16 });
    if (h.box && prev) {
      const mx = h.cx - prev.cx, my = h.cy - prev.cy;
      if (Math.abs(mx) + Math.abs(my) > 1) heading = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? "ArrowRight" : "ArrowLeft") : my > 0 ? "ArrowDown" : "ArrowUp";
    }
    if (h.box) prev = { cx: h.cx, cy: h.cy };
    if (h.box && f.box) {
      const dx = f.cx - h.cx, dy = f.cy - h.cy, half = h.box.w / 2;
      let want = Math.abs(dx) > half ? (dx > 0 ? "ArrowRight" : "ArrowLeft") : dy > 0 ? "ArrowDown" : "ArrowUp";
      if (want === opposite[heading]) want = Math.abs(dy) > half ? (dy > 0 ? "ArrowDown" : "ArrowUp") : h.cy < s.h / 2 ? "ArrowDown" : "ArrowUp";
      if (want !== lastKey && want !== heading) { await env.press(want); lastKey = want; }
      else if (want === heading) lastKey = want;
    }
    await env.advance(40);
  }
  const s = await env.shot();
  return { score: scoreSquares(s), over: isGameOver(s) };
}

const snakeSlow: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "step-250ms", "change", async () => {
    const m = await headMoveCells(env, 2500);
    return [near(m.cells, 10, 1.01), `2.5 秒で ${m.cells.toFixed(2)} マス`];
  }),
  await fresh(env, entry, data, seed, "turn-with-arrow", "retain", async () => {
    const a = blob(await env.shot(), HEAD, 20);
    const cell = a.box!.w + 2;
    await env.press("ArrowDown");
    await env.advance(1200);
    const b = blob(await env.shot(), HEAD, 20);
    return [(b.cy - a.cy) / cell >= 3, `下へ ${((b.cy - a.cy) / cell).toFixed(1)} マス`];
  }),
  await fresh(env, entry, data, seed, "eat-score", "retain", async () => {
    const r = await steerToFood(env, 15000, 1);
    return [r.score >= 1 && !r.over, `得点 ${r.score}`];
  }),
  await fresh(env, entry, data, seed, "wall-gameover-restart-colors", "retain", async () => {
    await env.press("ArrowUp");
    await env.advance(8000);
    if (!isGameOver(await env.shot())) return [false, "壁でゲームオーバーにならない"];
    await env.press("KeyR");
    await env.advance(30);
    const s = await env.shot();
    return [!isGameOver(s) && scoreSquares(s) === 0 && blob(s, HEAD, 20).count > 50 && blob(s, BODY, 20).count > 100, "再開・色"];
  }),
];

const snakeRestart: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "speed-before-restart", "retain", async () => {
    const m = await headMoveCells(env, 1500);
    return [near(m.cells, 10, 1.01), `${m.cells.toFixed(2)} マス`];
  }),
  await fresh(env, entry, data, seed, "speed-after-restart-x2", "change", async () => {
    await env.advance(300);
    await env.press("KeyR");
    await env.advance(0);
    const m1 = await headMoveCells(env, 1500);
    await env.press("KeyR");
    await env.advance(0);
    const m2 = await headMoveCells(env, 1500);
    return [near(m1.cells, 10, 1.01) && near(m2.cells, 10, 1.01), `1 回目 ${m1.cells.toFixed(2)}・2 回目 ${m2.cells.toFixed(2)} マス`];
  }),
  await fresh(env, entry, data, seed, "eat-score", "retain", async () => {
    const r = await steerToFood(env, 12000, 1);
    return [r.score >= 1 && !r.over, `得点 ${r.score}`];
  }),
];

// ---------- ポン共通 ----------
function paddles(s: Shot) {
  const left = blob(s, WHITE, 20, { x: 12, y: 0, w: 26, h: s.h });
  const right = blob(s, WHITE, 20, { x: s.w - 38, y: 0, w: 26, h: s.h });
  const ball = blob(s, WHITE, 20, { x: 40, y: 0, w: s.w - 80, h: s.h });
  return { left, right, ball };
}
/** パドル中心がボールから offset だけずれた位置で受ける（offset=26 はパドルの端寄り。60px のパドルの当たり幅は ±35）。 */
async function rally(env: EvalEnv, offset = 0): Promise<[boolean, string]> {
  let wentLeft = false;
  for (let t = 0; t < 6000; t += 50) {
    const s = await env.shot();
    if (components(s, CYAN, 30, { x: s.w / 2, y: 0, w: s.w / 2, h: 16 }, 30).length > 0) return [false, "CPU に点が入った"];
    const p = paddles(s);
    if (p.ball.box && p.ball.cx < 80) wentLeft = true;
    if (wentLeft && p.ball.box && p.ball.cx > 240) return [true, "打ち返した"];
    const target = (p.ball.box ? p.ball.cy : 180) - offset;
    const d = p.left.box ? target - p.left.cy : 0;
    const ms = Math.max(16, Math.min(50, Math.round(Math.abs(d) / 0.3)));
    if (d < -3) await env.hold("KeyW", ms);
    else if (d > 3) await env.hold("KeyS", ms);
    else await env.advance(50);
  }
  return [false, wentLeft ? "左へ来たが戻らない" : "ボールが左へ来ない"];
}
async function letMiss(env: EvalEnv): Promise<[boolean, string]> {
  await env.hold("KeyW", 1500);
  for (let t = 0; t < 5000; t += 100) {
    await env.advance(100);
    const s = await env.shot();
    if (components(s, CYAN, 30, { x: s.w / 2, y: 0, w: s.w / 2, h: 16 }, 30).length >= 1) return [true, "CPU の得点表示"];
  }
  return [false, "CPU に点が入らない"];
}

const pongPaddle: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "left-paddle-90", "change", async () => {
    const p = paddles(await env.shot());
    return [near(p.left.box?.h ?? 0, 90, 3), `左 ${p.left.box?.h}`];
  }),
  await fresh(env, entry, data, seed, "right-paddle-60-and-w-moves", "retain", async () => {
    const a = paddles(await env.shot());
    await env.hold("KeyW", 300);
    const b = paddles(await env.shot());
    return [near(a.right.box?.h ?? 0, 60, 3) && a.left.cy - b.left.cy >= 40, `右 ${a.right.box?.h} 上へ ${(a.left.cy - b.left.cy).toFixed(0)}`];
  }),
  await fresh(env, entry, data, seed, "rally", "retain", () => rally(env)),
  await fresh(env, entry, data, seed, "cpu-scores-on-miss", "retain", () => letMiss(env)),
];

const pongCollision: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "bounce-near-paddle-edge-up", "change", () => rally(env, 26)),
  await fresh(env, entry, data, seed, "bounce-near-paddle-edge-down", "change", () => rally(env, -26)),
  await fresh(env, entry, data, seed, "bounce-center", "retain", () => rally(env)),
  await fresh(env, entry, data, seed, "cpu-scores-on-miss", "retain", () => letMiss(env)),
  await fresh(env, entry, data, seed, "paddle-60-w-moves", "retain", async () => {
    const a = paddles(await env.shot());
    await env.hold("KeyW", 300);
    const b = paddles(await env.shot());
    return [near(a.left.box?.h ?? 0, 60, 3) && a.left.cy - b.left.cy >= 40, `左 ${a.left.box?.h}`];
  }),
];

// ---------- よけゲーム共通 ----------
async function enemySpeed(env: EvalEnv) {
  await env.advance(900);
  const c1 = components(await env.shot(), RED, 30, { x: 0, y: 20, w: 480, h: 280 });
  if (!c1.length) return NaN;
  const e = c1[0];
  await env.advance(100);
  const c2 = components(await env.shot(), RED, 30).sort((a, b) => Math.abs(a.cx - e.cx) - Math.abs(b.cx - e.cx));
  return c2.length ? (c2[0].cy - e.cy) / 100 : NaN;
}
async function playerFollows(env: EvalEnv, xs: number[]) {
  const got: number[] = [];
  for (const x of xs) {
    await env.pointer(x, 200);
    await env.advance(16);
    got.push(blob(await env.shot(), GREEN, 30, { x: 0, y: 300, w: 480, h: 60 }).cx);
  }
  return got;
}
async function dodgeCollision(env: EvalEnv): Promise<[boolean, string]> {
  await env.pointer(240, 200);
  for (let i = 0; i < 100; i++) {
    const es = components(await env.shot(), RED, 30).sort((a, b) => b.cy - a.cy);
    if (es.length) await env.pointer(Math.max(10, Math.min(env.width - 10, es[0].cx)), 200);
    await env.advance(150);
    if (isGameOver(await env.shot())) {
      await env.click(240, 200);
      await env.advance(30);
      const s = await env.shot();
      return [!isGameOver(s), "ゲームオーバー後に再開"];
    }
  }
  return [false, "当たってもゲームオーバーにならない"];
}

const dodgeMulti: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "player-green-not-blue", "change", async () => {
    const s = await env.shot();
    const g = blob(s, GREEN, 30, { x: 0, y: 300, w: 480, h: 60 }), b = blob(s, hex("#0080ff"), 30);
    return [g.count >= 300 && b.count === 0, `緑 ${g.count} 青 ${b.count}`];
  }),
  await fresh(env, entry, data, seed, "enemy-speed-x2", "change", async () => {
    const v = await enemySpeed(env);
    return [near(v, 0.3, 0.03), `${v.toFixed(3)} px/ms`];
  }),
  await fresh(env, entry, data, seed, "pointer-follow", "retain", async () => {
    const g = await playerFollows(env, [100, 380]);
    return [near(g[0], 100, 3) && near(g[1], 380, 3), g.map((x) => x.toFixed(1)).join(",")];
  }),
  await fresh(env, entry, data, seed, "collision-gameover-restart", "retain", () => dodgeCollision(env)),
];

const dodgeNarrow: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "narrow-pointer", "change", async () => {
    const got: number[] = [];
    for (const x of [60, 180]) {
      await env.pointer(x, 200);
      await env.advance(16);
      got.push(blob(await env.shot(), GREEN, 30, { x: 0, y: 300, w: 240, h: 60 }).cx);
    }
    return [near(got[0], 60, 3) && near(got[1], 180, 3), got.map((x) => x.toFixed(1)).join(",")];
  }, { narrow: true }),
  await fresh(env, entry, data, seed, "wide-pointer", "retain", async () => {
    const g = await playerFollows(env, [300]);
    return [near(g[0], 300, 3), g[0].toFixed(1)];
  }),
  await fresh(env, entry, data, seed, "enemy-speed-kept", "retain", async () => {
    const v = await enemySpeed(env);
    return [near(v, 0.15, 0.02), `${v.toFixed(3)} px/ms`];
  }),
  await fresh(env, entry, data, seed, "collision-gameover-restart", "retain", () => dodgeCollision(env)),
];

// ---------- 的当て共通 ----------
const MAGENTA = hex("#ff00ff");
async function hitTargets(env: EvalEnv, n: number) {
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const s = await env.shot();
    const t = blob(s, MAGENTA, 30);
    if (!t.box) break;
    const before = scoreSquares(s);
    await env.click(t.cx, t.cy);
    await env.advance(16);
    const s2 = await env.shot();
    const t2 = blob(s2, MAGENTA, 30);
    if (scoreSquares(s2) === before + 1 && (Math.abs(t2.cx - t.cx) > 2 || Math.abs(t2.cy - t.cy) > 2)) hits++;
  }
  return hits;
}
async function timerAt(env: EvalEnv, seconds: number): Promise<[boolean, string]> {
  await env.advance(seconds * 1000 - 500 - env.t);
  if (isGameOver(await env.shot())) return [false, `${seconds - 0.5} 秒で終了`];
  await env.advance(1000);
  if (!isGameOver(await env.shot())) return [false, `${seconds + 0.5} 秒で終わらない`];
  await env.advance(600);
  await env.click(240, 180);
  await env.advance(30);
  const s = await env.shot();
  return [!isGameOver(s) && scoreSquares(s) === 0, "再開"];
}

const targetTimer: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "radius-12", "change", async () => {
    const t = blob(await env.shot(), MAGENTA, 30);
    return [near(t.box?.w ?? 0, 24, 3) && near(t.box?.h ?? 0, 24, 3), `${t.box?.w}×${t.box?.h}`];
  }),
  await fresh(env, entry, data, seed, "time-20s-bar-restart", "change", async () => {
    await env.advance(10000);
    const bar = blob(await env.shot(), WHITE, 20, { x: 0, y: 352, w: 480, h: 8 });
    if (!bar.box || !near(bar.box.w / 480, 0.5, 0.05)) return [false, `10 秒時のバー ${bar.box?.w}`];
    return timerAt(env, 20);
  }),
  await fresh(env, entry, data, seed, "click-scores", "retain", async () => {
    const h = await hitTargets(env, 3);
    return [h === 3, `${h}/3`];
  }),
];

const targetHit: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "center-click-scores", "change", async () => {
    const h = await hitTargets(env, 5);
    return [h === 5, `${h}/5`];
  }),
  await fresh(env, entry, data, seed, "miss-no-score-radius-20", "retain", async () => {
    const s = await env.shot();
    const t = blob(s, MAGENTA, 30);
    const fx = t.cx < 240 ? 440 : 40, fy = t.cy < 180 ? 320 : 50;
    await env.click(fx, fy);
    await env.advance(16);
    const s2 = await env.shot();
    return [scoreSquares(s2) === 0 && near(t.box?.w ?? 0, 40, 3), `半径 ${(t.box?.w ?? 0) / 2}`];
  }),
  await fresh(env, entry, data, seed, "time-30s-restart", "retain", () => timerAt(env, 30)),
];

// ---------- 散布図 ----------
const scatterLegend: Check = async (env, entry, data, seed) => {
  const groups = (data as { groups: { name: string; color: string }[] }).groups;
  const out: CheckResult[] = [];
  const analyse = (s: Shot) =>
    groups.map((g) => {
      const comps = components(s, hex(g.color), 24, undefined, 6);
      const chips = comps.filter((b) => b.box!.w >= 11 && b.box!.w <= 18 && b.box!.h >= 11 && b.box!.h <= 18 && b.count >= 100);
      const dots = comps.filter((b) => !chips.includes(b));
      return { name: g.name, chips, dotPixels: dots.reduce((a, b) => a + b.count, 0), dots: dots.length };
    });
  out.push(await fresh(env, entry, data, seed, "legend-right-vertical", "change", async () => {
    const a = analyse(await env.shot());
    const chips = a.map((g) => g.chips[0]);
    if (chips.some((c) => !c)) return [false, "凡例の色見本が見つからない"];
    const right = chips.every((c) => c!.box!.x >= 480 - 120);
    const xs = chips.map((c) => c!.cx), ys = chips.map((c) => c!.cy).sort((p, q) => p - q);
    const vertical = Math.max(...xs) - Math.min(...xs) <= 10 && ys.every((y, i) => i === 0 || y - ys[i - 1] >= 14);
    return [right && vertical, `x=${xs.map((x) => x.toFixed(0)).join(",")} y=${ys.map((y) => y.toFixed(0)).join(",")}`];
  }));
  out.push(await fresh(env, entry, data, seed, "filter-by-legend", "retain", async () => {
    const a0 = analyse(await env.shot());
    if (a0.some((g) => !g.chips[0] || g.dots < 15)) return [false, `点 ${a0.map((g) => g.dots).join(",")}`];
    for (let k = 0; k < groups.length; k++) {
      const chip = a0[k].chips[0];
      await env.click(chip.cx, chip.cy);
      await env.advance(16);
      const a1 = analyse(await env.shot());
      const hidden = a1[k].dotPixels === 0;
      // 隠した系列の下にあった点が見えるので、他の系列は減らなければよい
      const others = a1.every((g, j) => j === k || g.dotPixels >= a0[j].dotPixels * 0.95);
      await env.click(chip.cx, chip.cy);
      await env.advance(16);
      const a2 = analyse(await env.shot());
      const restored = Math.abs(a2[k].dotPixels - a0[k].dotPixels) <= a0[k].dotPixels * 0.05;
      if (!hidden || !others || !restored) return [false, `${groups[k].name}: hidden=${hidden} others=${others} restored=${restored}`];
    }
    return [true, `点 ${a0.map((g) => g.dots).join(",")}`];
  }));
  return out;
};

export const CHECKS: Record<string, Check> = {
  "N1-runner": runner,
  "N2-coins": coins,
  "N3-shooter": shooter,
  "N4-catch": catchGame,
  "M1-snake-slow": snakeSlow,
  "M2-pong-paddle": pongPaddle,
  "M3-dodge-multiturn": dodgeMulti,
  "M4-target-timer": targetTimer,
  "R1-snake-restart": snakeRestart,
  "R2-dodge-narrow": dodgeNarrow,
  "R3-pong-collision": pongCollision,
  "R4-target-hit": targetHit,
  "V1-scatter-legend": scatterLegend,
};
