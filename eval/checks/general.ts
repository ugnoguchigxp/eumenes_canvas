// 汎用課題 general-v1 の判定（評価担当が凍結、docs/eval/general-v1.md）。画素の観測だけで判定する。作品の status は使わない。
// 制作担当には渡さない。期待値はこのファイルにだけ置く。
import { blob, components, EvalEnv, hex, isGameOver, scoreSquares, type Blob, type CheckResult, type RGB, type Shot } from "../lib/env";

export type Check = (env: EvalEnv, entry: string, data: unknown, seed: number) => Promise<CheckResult[]>;

const GREEN = hex("#00ff00"), RED = hex("#ff0000"), WHITE = hex("#ffffff"), CYAN = hex("#00ffff"), GRAY = hex("#808080"), YELLOW = hex("#ffff00"), BLACK = hex("#000000");
const CLEAR = hex("#003000");

const res = (id: string, kind: CheckResult["kind"], pass: boolean, detail?: string): CheckResult => ({ id, kind, pass, detail });
const near = (a: number | undefined, b: number, tol: number) => a !== undefined && Number.isFinite(a) && Math.abs(a - b) <= tol;
const f1 = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? "NaN" : x.toFixed(1));
const bottom = (b: Blob) => (b.box ? b.box.y + b.box.h : NaN);

/** 1 つの観点を新しいセッションで試す。例外・起動失敗・実行時エラーは不合格。 */
async function fresh(env: EvalEnv, entry: string, data: unknown, seed: number, id: string, kind: CheckResult["kind"], fn: () => Promise<[boolean, string?]>): Promise<CheckResult> {
  try {
    const r = await env.start(entry, data, seed);
    if (r.type !== "ready") return res(id, kind, false, "起動しない");
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

/** 色が全面の 30% 以上を占めるか（クリア・終了の背景）。 */
const covers = (s: Shot, c: RGB, frac = 0.3) => blob(s, c, 12).count >= s.w * s.h * frac;

async function frameBox(env: EvalEnv) {
  return (await env.page.locator("#frame").boundingBox())!;
}
/** ボタンを押したまま点を順にたどる（steps は各区間の pointermove の数）。最後に離す。 */
async function drag(env: EvalEnv, pts: [number, number][], steps: number, release = true) {
  const b = await frameBox(env);
  await env.pointer(pts[0][0], pts[0][1]);
  await env.page.mouse.down();
  await env.advance(0);
  for (const [x, y] of pts.slice(1)) {
    await env.page.mouse.move(b.x + x, b.y + y, { steps });
    await env.advance(16);
  }
  if (release) {
    await env.page.mouse.up();
    await env.advance(16);
  }
}
async function mouseTo(env: EvalEnv, x: number, y: number, steps = 1) {
  const b = await frameBox(env);
  await env.page.mouse.move(b.x + x, b.y + y, { steps });
}

// =============== G-N1 チャージして投げる ===============
const throwGame: Check = async (env, entry, data, seed) => {
  const GY = 320, OX = 56, OY = 288;
  const ball = (s: Shot) => components(s, WHITE, 40, { x: 0, y: 16, w: 480, h: GY - 16 }, 20).filter((b) => b.box!.w >= 8 && b.box!.w <= 16 && b.box!.h >= 8 && b.box!.h <= 16)[0];
  const target = (s: Shot) => components(s, RED, 30, { x: 0, y: 200, w: 480, h: 130 }, 100).filter((b) => near(b.box!.h, 30, 3) && near(b.box!.w, 30, 3))[0];
  const throwFor = async (holdMs: number, waitMs: number) => {
    await env.down("Space");
    await env.advance(holdMs);
    await env.up("Space");
    await env.advance(waitMs);
  };
  /** 的の中心に落ちる初速を解き、押す時間を返す（判定側の計算。初速 600p、45 度、重力 600）。 */
  const aimHold = (tcx: number) => {
    const x = tcx - OX;
    const v = Math.sqrt((600 * x * x) / (GY - 15 - OY + x));
    return Math.round((Math.min(600, v) / 600) * 1000);
  };
  return [
    await fresh(env, entry, data, seed, "layout", "start", async () => {
      const s = await env.shot();
      const p = blob(s, GREEN);
      const g = blob(s, GRAY, 20, { x: 0, y: 300, w: 480, h: 40 });
      const ok = !!p.box && near(p.box.w, 16, 2) && near(p.box.h, 32, 2) && near(p.box.x, 40, 3) && near(bottom(p), GY, 3) && !!g.box && near(g.box.y, GY, 2) && near(g.box.h, 4, 1) && g.box.w >= 400 && !!target(s);
      return [ok, `自機 ${JSON.stringify(p.box)} 地面 ${JSON.stringify(g.box)} 的 ${!!target(s)}`];
    }),
    await fresh(env, entry, data, seed, "charge-bar", "start", async () => {
      const bar = (s: Shot) => blob(s, WHITE, 30, { x: 0, y: 326, w: 480, h: 34 });
      await env.down("Space");
      await env.advance(500);
      const a = bar(await env.shot());
      await env.advance(1000);
      const b = bar(await env.shot());
      await env.up("Space");
      const ok = !!a.box && !!b.box && near(a.box.w, 100, 10) && near(b.box.w, 200, 6) && near(a.box.x, 40, 3) && near(a.box.h, 8, 2) && near(a.box.y, 332, 3);
      return [ok, `0.5 秒 ${JSON.stringify(a.box)} 1.5 秒 ${JSON.stringify(b.box)}`];
    }),
    await fresh(env, entry, data, seed, "throw-trajectory", "retain", async () => {
      await throwFor(1000, 100);
      const a = ball(await env.shot());
      await env.advance(200);
      const b = ball(await env.shot());
      if (!a || !b) return [false, `球 ${!!a} ${!!b}`];
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      const ok = near(a.cx, OX + 42.4, 14) && near(a.cy, OY - 42.4 + 3, 14) && near(dx, 84.9, 10) && near(dy, -60.9, 10);
      return [ok, `0.1 秒 (${f1(a.cx)},${f1(a.cy)}) 0.2 秒の移動 (${f1(dx)},${f1(dy)})`];
    }),
    await fresh(env, entry, data, seed, "hit-score-gameover-restart", "retain", async () => {
      let thrown = 0, score = 0;
      while (thrown < 3 && score < 1) {
        const t = target(await env.shot());
        if (!t) return [false, "的が見つからない"];
        await throwFor(aimHold(t.cx), 2500);
        thrown++;
        score = scoreSquares(await env.shot());
      }
      if (score < 1) return [false, `${thrown} 球で得点なし`];
      while (thrown < 5) {
        await throwFor(100, 1500);
        thrown++;
        const s = await env.shot();
        if (thrown === 4 && isGameOver(s)) return [false, "4 球でゲームオーバー"];
      }
      const s = await env.shot();
      if (!isGameOver(s)) return [false, "5 球でゲームオーバーにならない"];
      if (scoreSquares(s) !== score) return [false, `終了画面の得点 ${scoreSquares(s)}（期待 ${score}）`];
      await env.press("KeyR");
      await env.advance(50);
      const r = await env.shot();
      return [!isGameOver(r) && scoreSquares(r) === 0 && blob(r, GREEN).count > 300, `得点 ${score}、R で再開`];
    }),
  ];
};

// =============== G-N2 足場 ===============
const platforms: Check = async (env, entry, data, seed) => {
  const GROUND = 330;
  const me = async () => blob(await env.shot(), GREEN);
  /** 自機の中心を x へ（←→ を 32ms ずつ押す閉ループ）。 */
  const walkTo = async (x: number) => {
    for (let i = 0; i < 120; i++) {
      const p = await me();
      if (!p.box) return false;
      if (Math.abs(p.cx - x) <= 3) return true;
      await env.hold(p.cx < x ? "ArrowRight" : "ArrowLeft", Math.min(32, Math.max(16, Math.round((Math.abs(p.cx - x) / 160) * 1000))));
    }
    return false;
  };
  const settle = async () => {
    let last = NaN;
    for (let i = 0; i < 40; i++) {
      await env.advance(48);
      const b = bottom(await me());
      if (near(b, last, 0.5)) return b;
      last = b;
    }
    return last;
  };
  const jumpRight = async (ms: number) => {
    await env.press("Space");
    await env.down("ArrowRight");
    await env.advance(ms);
    await env.up("ArrowRight");
    return settle();
  };
  return [
    await fresh(env, entry, data, seed, "layout", "start", async () => {
      const s = await env.shot();
      const p = blob(s, GREEN);
      const plats = components(s, CYAN, 30, { x: 0, y: 16, w: 480, h: 320 }, 200).sort((a, b) => a.box!.x - b.box!.x);
      const want = [[110, 100, 260], [250, 100, 190], [360, 90, 120]];
      const platOk = plats.length === 3 && plats.every((q, i) => near(q.box!.x, want[i][0], 3) && near(q.box!.w, want[i][1], 3) && near(q.box!.y, want[i][2], 3) && near(q.box!.h, 10, 2));
      const ground = blob(s, GRAY, 20, { x: 0, y: 330, w: 480, h: 30 }).count >= 480 * 28;
      const ok = !!p.box && near(p.box.w, 16, 2) && near(p.box.h, 24, 2) && near(p.box.x, 30, 3) && near(bottom(p), GROUND, 3) && platOk && ground;
      return [ok, `自機 ${JSON.stringify(p.box)} 足場 ${plats.map((q) => `${q.box!.x},${q.box!.y},${q.box!.w}`).join(" ")} 地面 ${ground}`];
    }),
    await fresh(env, entry, data, seed, "walk-160", "retain", async () => {
      const a = await me();
      await env.hold("ArrowRight", 500);
      const b = await me();
      await env.hold("ArrowLeft", 250);
      const c = await me();
      return [near(b.cx - a.cx, 80, 10) && near(c.cx - b.cx, -40, 8), `右 ${f1(b.cx - a.cx)} 左 ${f1(c.cx - b.cx)}`];
    }),
    await fresh(env, entry, data, seed, "jump-apex", "retain", async () => {
      await env.advance(32);
      const b0 = bottom(await me());
      await env.press("Space");
      let top = b0;
      for (let i = 0; i < 30; i++) {
        await env.advance(24);
        top = Math.min(top, bottom(await me()));
      }
      const end = await settle();
      return [near(b0 - top, 96.6, 8) && near(end, GROUND, 2), `上昇 ${f1(b0 - top)} 着地 ${f1(end)}`];
    }),
    await fresh(env, entry, data, seed, "platform-from-below-and-fall", "retain", async () => {
      if (!(await walkTo(160))) return [false, "A の下へ行けない"];
      await env.press("Space");
      const onA = await settle();
      if (!near(onA, 260, 3)) return [false, `A に乗らない（下端 ${f1(onA)}）`];
      for (let i = 0; i < 40; i++) {
        const p = await me();
        if (p.box && p.box.x > 214) break;
        await env.hold("ArrowRight", 32);
      }
      const end = await settle();
      return [near(end, GROUND, 3), `A ${f1(onA)} → 端から出て ${f1(end)}`];
    }),
    await fresh(env, entry, data, seed, "climb-to-star", "retain", async () => {
      if (!(await walkTo(160))) return [false, "A の下へ行けない"];
      await env.press("Space");
      if (!near(await settle(), 260, 3)) return [false, "A に乗らない"];
      if (!(await walkTo(195))) return [false, "A の右端へ行けない"];
      const onB = await jumpRight(560);
      if (!near(onB, 190, 3)) return [false, `B に乗らない（下端 ${f1(onB)}）`];
      if (!(await walkTo(335))) return [false, "B の右端へ行けない"];
      const onC = await jumpRight(450);
      let s = await env.shot();
      if (scoreSquares(s) < 1 && near(onC, 120, 3)) {
        await env.press("Space");
        await settle();
        s = await env.shot();
      }
      const star = components(s, YELLOW, 30, { x: 0, y: 20, w: 480, h: 320 }, 60).filter((b) => near(b.box!.w, 12, 2) && near(b.box!.h, 12, 2))[0];
      const ok = scoreSquares(s) === 1 && !!star && near(star.cx, 160, 3) && near(bottom(star), 230, 3);
      return [ok, `C ${f1(onC)} 得点 ${scoreSquares(s)} 星 ${star ? `${f1(star.cx)},${bottom(star)}` : "なし"}`];
    }),
  ];
};

// =============== G-N3 神経衰弱 ===============
const CARD_COLORS = ["#ff0000", "#00ff00", "#0080ff", "#ff8000", "#c000ff", "#00ffff"].map(hex);
const cardPos = (i: number) => ({ x: 60 + (i % 4) * 90, y: 40 + Math.floor(i / 4) * 100 });
/** カードの内側の色：6 色のどれか（90% 以上）、灰色なら "back"、それ以外は null。 */
function cardFace(s: Shot, i: number): number | "back" | null {
  const { x, y } = cardPos(i), r = { x: x + 8, y: y + 8, w: 44, h: 64 };
  const n = r.w * r.h;
  if (blob(s, GRAY, 12, r).count >= n * 0.9) return "back";
  for (let k = 0; k < CARD_COLORS.length; k++) if (blob(s, CARD_COLORS[k], 30, r).count >= n * 0.9) return k;
  return null;
}
const memory: Check = async (env, entry, data, seed) => {
  const clickCard = async (i: number) => {
    const { x, y } = cardPos(i);
    await env.click(x + 30, y + 40);
    await env.advance(16);
    return cardFace(await env.shot(), i);
  };
  return [
    await fresh(env, entry, data, seed, "layout-face-down", "start", async () => {
      const s = await env.shot();
      const backs = components(s, GRAY, 12, undefined, 1000);
      const ok = backs.length === 12 && Array.from({ length: 12 }, (_, i) => cardPos(i)).every((p) => backs.some((b) => near(b.box!.x, p.x, 2) && near(b.box!.y, p.y, 2) && near(b.box!.w, 60, 2) && near(b.box!.h, 80, 2)));
      return [ok, `裏 ${backs.length} 枚`];
    }),
    await fresh(env, entry, data, seed, "flip-shows-color", "retain", async () => {
      const f = await clickCard(5);
      const s = await env.shot();
      const others = Array.from({ length: 12 }, (_, i) => i).filter((i) => i !== 5).every((i) => cardFace(s, i) === "back");
      return [typeof f === "number" && others, `表 ${f}`];
    }),
    await fresh(env, entry, data, seed, "mismatch-back-and-lock", "retain", async () => {
      for (let i = 0; i + 2 < 12; i += 2) {
        const a = await clickCard(i);
        const b = await clickCard(i + 1);
        if (typeof a !== "number" || typeof b !== "number") return [false, `表にならない ${a} ${b}`];
        if (a === b) continue;
        await env.advance(400);
        let s = await env.shot();
        if (cardFace(s, i) !== a || cardFace(s, i + 1) !== b) return [false, "0.4 秒で裏に戻った"];
        const locked = await clickCard(i + 2);
        if (locked !== "back") return [false, "待ちの間にめくれた"];
        await env.advance(600);
        s = await env.shot();
        return [cardFace(s, i) === "back" && cardFace(s, i + 1) === "back" && cardFace(s, i + 2) === "back", `違う色 ${a}・${b} が 1 秒後に裏`];
      }
      return [false, "違う色の組が見つからない"];
    }),
    await fresh(env, entry, data, seed, "match-all-clear-restart", "retain", async () => {
      const known = new Map<number, number>();
      const done = new Set<number>();
      for (let step = 0; step < 30 && done.size < 12; step++) {
        const a = Array.from({ length: 12 }, (_, i) => i).find((i) => !done.has(i) && !known.has(i)) ?? Array.from({ length: 12 }, (_, i) => i).find((i) => !done.has(i))!;
        const ca = await clickCard(a);
        if (typeof ca !== "number") return [false, `カード ${a} が表にならない`];
        known.set(a, ca);
        let b = [...known.entries()].find(([i, c]) => i !== a && c === ca && !done.has(i))?.[0];
        if (b === undefined) b = Array.from({ length: 12 }, (_, i) => i).find((i) => i !== a && !done.has(i) && !known.has(i));
        if (b === undefined) return [false, "相手が見つからない"];
        const cb = await clickCard(b);
        if (typeof cb !== "number") return [false, `カード ${b} が表にならない`];
        known.set(b, cb);
        if (ca === cb) { done.add(a); done.add(b); }
        else await env.advance(900);
      }
      const s = await env.shot();
      const faces = Array.from({ length: 12 }, (_, i) => cardFace(s, i));
      if (done.size < 12 || faces.some((f) => typeof f !== "number")) return [false, `そろった ${done.size / 2} 組`];
      if (scoreSquares(s) !== 6 || !covers(s, CLEAR, 0.3)) return [false, `組数 ${scoreSquares(s)} クリア背景 ${blob(s, CLEAR, 12).count}`];
      await env.click(20, 340);
      await env.advance(16);
      const r = await env.shot();
      const backs = Array.from({ length: 12 }, (_, i) => cardFace(r, i)).every((f) => f === "back");
      return [backs && scoreSquares(r) === 0 && !covers(r, CLEAR, 0.1), "6 組そろえてクリア、クリックで並べ直し"];
    }),
  ];
};

// =============== G-N4 砲台 ===============
const turret: Check = async (env, entry, data, seed) => {
  const OX = 240, OY = 334;
  const bullets = (s: Shot) => components(s, WHITE, 30, { x: 0, y: 16, w: 480, h: 334 }, 16).filter((b) => b.box!.w >= 4 && b.box!.w <= 9 && b.box!.h >= 4 && b.box!.h <= 9);
  const enemy = (s: Shot) => components(s, RED, 30, undefined, 300).filter((b) => near(b.box!.w, 24, 2) && near(b.box!.h, 24, 2))[0];
  const bar = (s: Shot) => blob(s, CYAN, 30, { x: 0, y: 350, w: 480, h: 10 });
  const nearOrigin = (s: Shot) => bullets(s).filter((b) => Math.hypot(b.cx - OX, b.cy - OY) <= 40);
  return [
    await fresh(env, entry, data, seed, "layout", "start", async () => {
      const s = await env.shot();
      const g = blob(s, GREEN), b = bar(s), e = enemy(s);
      const ok = !!g.box && near(g.box.w, 30, 2) && near(g.box.h, 16, 2) && near(g.cx, 240, 2) && near(bottom(g), 350, 2) && !!b.box && near(b.box.w, 100, 4) && near(b.box.x, 190, 3) && near(b.box.h, 4, 1) && near(bottom(b), 360, 1) && !!e && e.box!.y >= 38 && e.box!.y <= 162 && e.box!.x >= 38 && e.box!.x <= 442;
      return [ok, `砲台 ${JSON.stringify(g.box)} バー ${JSON.stringify(b.box)} 敵 ${JSON.stringify(e?.box)}`];
    }),
    await fresh(env, entry, data, seed, "aim-and-speed", "retain", async () => {
      await env.pointer(100, 100);
      await env.advance(16);
      await env.press("Space");
      await env.advance(100);
      const a = bullets(await env.shot())[0];
      await env.advance(200);
      const b = bullets(await env.shot())[0];
      if (!a || !b) return [false, `弾 ${!!a} ${!!b}`];
      const L = Math.hypot(100 - OX, 100 - OY), ux = (100 - OX) / L, uy = (100 - OY) / L;
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      const ok = near(a.cx, OX + 40 * ux, 10) && near(a.cy, OY + 40 * uy, 10) && near(dx, 80 * ux, 8) && near(dy, 80 * uy, 8);
      return [ok, `0.1 秒 (${f1(a.cx)},${f1(a.cy)}) 0.2 秒の移動 (${f1(dx)},${f1(dy)})`];
    }),
    await fresh(env, entry, data, seed, "cooldown", "retain", async () => {
      await env.pointer(240, 60);
      await env.advance(16);
      await env.press("Space");
      await env.advance(50);
      const w0 = bar(await env.shot()).box?.w ?? 0;
      await env.advance(50);
      await env.press("Space");
      await env.advance(50);
      const blocked = nearOrigin(await env.shot()).length === 0;
      await env.advance(250);
      const w4 = bar(await env.shot()).box?.w;
      await env.advance(450);
      await env.press("Space");
      await env.advance(50);
      const again = nearOrigin(await env.shot()).length === 1;
      return [w0 <= 12 && blocked && near(w4, 50, 8) && again, `直後 ${w0} 連射不可 ${blocked} 0.4 秒 ${w4} 0.85 秒で再射 ${again}`];
    }),
    await fresh(env, entry, data, seed, "hit-score", "retain", async () => {
      const e = enemy(await env.shot());
      if (!e) return [false, "敵なし"];
      await env.pointer(e.cx, e.cy);
      await env.advance(16);
      await env.press("Space");
      await env.advance(Math.ceil((Math.hypot(e.cx - OX, e.cy - OY) / 400) * 1000) + 200);
      const s = await env.shot();
      return [scoreSquares(s) === 1 && !!enemy(s), `得点 ${scoreSquares(s)}`];
    }),
    await fresh(env, entry, data, seed, "timeup-gameover-restart", "retain", async () => {
      const e = enemy(await env.shot());
      if (!e) return [false, "敵なし"];
      await env.pointer(e.cx, e.cy);
      await env.advance(16);
      await env.press("Space");
      await env.advance(19500 - env.t);
      const s1 = await env.shot();
      if (isGameOver(s1)) return [false, "19.5 秒で終了"];
      await env.advance(1000);
      const s2 = await env.shot();
      if (!isGameOver(s2)) return [false, "20.5 秒で終わらない"];
      if (scoreSquares(s2) !== 1) return [false, `終了画面の得点 ${scoreSquares(s2)}`];
      await env.press("KeyR");
      await env.advance(50);
      const r = await env.shot();
      return [!isGameOver(r) && scoreSquares(r) === 0 && blob(r, GREEN).count > 300, "時間切れと R で再開"];
    }),
  ];
};

// =============== G-M1 ブロック崩し（2 ターン） ===============
const ROW = [["#ff0000", 40], ["#ff8000", 60], ["#ff00ff", 80], ["#00ffff", 100]] as const;
const breakout: Check = async (env, entry, data, seed) => {
  const ball = (s: Shot) => components(s, WHITE, 30, { x: 0, y: 16, w: 480, h: 344 }, 30).filter((b) => near(b.box!.w, 8, 2) && near(b.box!.h, 8, 2))[0];
  const blocks = (s: Shot) => ROW.reduce((n, [c]) => n + components(s, hex(c), 30, { x: 0, y: 20, w: 480, h: 200 }, 300).length, 0);
  return [
    await fresh(env, entry, data, seed, "rows-4", "change", async () => {
      const s = await env.shot();
      const rows = ROW.map(([c, y]) => components(s, hex(c), 30, { x: 0, y: 20, w: 480, h: 200 }, 300).filter((b) => near(b.box!.w, 50, 2) && near(b.box!.h, 14, 2) && near(b.box!.y, y, 2)).length);
      const blue = blob(s, hex("#0080ff"), 30).count;
      return [rows.every((n) => n === 8) && blue === 0, `各段 ${rows.join(",")} 青 ${blue}`];
    }),
    await fresh(env, entry, data, seed, "ball-speed-x1.5", "change", async () => {
      const a = ball(await env.shot());
      await env.advance(200);
      const b = ball(await env.shot());
      if (!a || !b) return [false, "ボールなし"];
      const d = Math.hypot(b.cx - a.cx, b.cy - a.cy);
      return [near(d, 72, 8), `0.2 秒で ${f1(d)}px`];
    }),
    await fresh(env, entry, data, seed, "paddle-follows-pointer", "retain", async () => {
      await env.pointer(100, 200);
      await env.advance(16);
      const a = blob(await env.shot(), GREEN);
      await env.pointer(380, 200);
      await env.advance(16);
      const b = blob(await env.shot(), GREEN);
      return [near(a.cx, 100, 3) && near(b.cx, 380, 3) && near(b.box?.w, 80, 2) && near(bottom(b), 330, 2), `${f1(a.cx)} ${f1(b.cx)}`];
    }),
    await fresh(env, entry, data, seed, "break-block-score", "retain", async () => {
      const n0 = blocks(await env.shot());
      for (let i = 0; i < 200; i++) {
        const s = await env.shot();
        if (scoreSquares(s) >= 1) return [blocks(s) < n0 && n0 > 0, `ブロック ${n0}→${blocks(s)} 得点 ${scoreSquares(s)}`];
        if (isGameOver(s)) return [false, "得点前にゲームオーバー"];
        const b = ball(s);
        if (b) await env.pointer(Math.max(40, Math.min(440, b.cx)), 200);
        await env.advance(32);
      }
      return [false, "得点しない"];
    }),
    await fresh(env, entry, data, seed, "miss-gameover-restart", "retain", async () => {
      for (let i = 0; i < 120; i++) {
        const s = await env.shot();
        if (isGameOver(s)) {
          await env.click(240, 200);
          await env.advance(32);
          const r = await env.shot();
          return [!isGameOver(r) && scoreSquares(r) === 0 && !!ball(r) && blocks(r) > 0, "取り逃して終了、クリックで再開"];
        }
        const b = ball(s);
        await env.pointer(b && b.cx < 240 ? 440 : 40, 200);
        await env.advance(100);
      }
      return [false, "取り逃してもゲームオーバーにならない"];
    }),
  ];
};

// =============== G-M2 ボールの落下 ===============
const INIT_BALLS = [["#ff0000", 120, 60], ["#00ff00", 240, 100], ["#0080ff", 360, 140]] as const;
const balls: Check = async (env, entry, data, seed) => {
  const whites = (s: Shot) => components(s, WHITE, 30, undefined, 200).filter((b) => near(b.box!.w, 24, 3) && near(b.box!.h, 24, 3));
  return [
    await fresh(env, entry, data, seed, "gravity-half", "change", async () => {
      const a = blob(await env.shot(), RED);
      await env.advance(300);
      const b = blob(await env.shot(), RED);
      const d = b.cy - a.cy;
      return [!!a.box && near(d, 18, 4), `0.3 秒で ${f1(d)}px`];
    }),
    await fresh(env, entry, data, seed, "click-adds-ball", "change", async () => {
      await env.click(60, 220);
      await env.click(420, 220);
      await env.advance(16);
      const w0 = whites(await env.shot());
      await env.advance(300);
      const w1 = whites(await env.shot()).sort((p, q) => p.cx - q.cx);
      const ok = w0.length === 2 && w1.length === 2 && near(w1[0].cx, 60, 3) && near(w1[1].cx, 420, 3) && w1.every((b) => near(b.cy - 220, 18, 5));
      return [ok, `直後 ${w0.length} 個 0.3 秒後 ${w1.map((b) => `${f1(b.cx)},${f1(b.cy)}`).join(" ")}`];
    }),
    await fresh(env, entry, data, seed, "max-10-oldest-removed", "change", async () => {
      for (let k = 0; k < 11; k++) await env.click(24 + 42 * k, 220);
      await env.advance(16);
      const w = whites(await env.shot());
      return [w.length === 10 && w.every((b) => b.cx > 45), `${w.length} 個、最も左 ${f1(Math.min(...w.map((b) => b.cx)))}`];
    }),
    await fresh(env, entry, data, seed, "initial-balls", "retain", async () => {
      const s = await env.shot();
      const got = INIT_BALLS.map(([c, x, y]) => {
        const b = blob(s, hex(c), 30);
        return !!b.box && near(b.cx, x, 2) && near(b.cy, y, 2) && near(b.box.w, 24, 2);
      });
      return [got.every(Boolean), got.join(",")];
    }),
    await fresh(env, entry, data, seed, "floor-bounce", "retain", async () => {
      let maxY = 0, rebound = 0;
      for (let i = 0; i < 60; i++) {
        await env.advance(50);
        const b = blob(await env.shot(), RED);
        if (!b.box) return [false, "赤いボールが消えた"];
        maxY = Math.max(maxY, b.cy);
        rebound = Math.max(rebound, maxY - b.cy);
      }
      return [maxY >= 340 && rebound >= 30, `最も低い ${f1(maxY)} はね返り ${f1(rebound)}`];
    }),
  ];
};

// =============== G-M3 お絵かき ===============
const BLUE = hex("#0000ff");
/** 列 x の、色 c の画素の縦の長さ（y0〜y1 の範囲）。 */
function strokeHeight(s: Shot, x: number, c: RGB, y0: number, y1: number) {
  return blob(s, c, 60, { x, y: y0, w: 1, h: y1 - y0 }).count;
}
const paint: Check = async (env, entry, data, seed) => {
  const line = (y: number, x0 = 100, x1 = 300) => drag(env, [[x0, y], [x1, y]], 20);
  return [
    await fresh(env, entry, data, seed, "thick-12", "change", async () => {
      await env.click(164, 20);
      await env.advance(16);
      await line(200);
      const h = strokeHeight(await env.shot(), 200, BLACK, 170, 230);
      return [near(h, 12, 2), `太さ ${h}`];
    }),
    await fresh(env, entry, data, seed, "eraser", "change", async () => {
      await line(150);
      const before = strokeHeight(await env.shot(), 200, BLACK, 130, 170);
      await env.click(196, 20);
      await env.click(164, 20);
      await env.advance(16);
      await line(150, 150, 250);
      const s = await env.shot();
      const left = blob(s, BLACK, 60, { x: 165, y: 135, w: 70, h: 30 }).count;
      const kept = strokeHeight(s, 120, BLACK, 130, 170);
      return [near(before, 4, 1) && left === 0 && near(kept, 4, 1), `消す前 ${before} 消した範囲の黒 ${left} 範囲外 ${kept}`];
    }),
    await fresh(env, entry, data, seed, "color-cancels-eraser", "change", async () => {
      await env.click(196, 20);
      await env.click(52, 20);
      await env.advance(16);
      await line(250);
      const s = await env.shot();
      const h = strokeHeight(s, 200, RED, 230, 270);
      const pinkButton = blob(s, hex("#ffc0c0"), 12, { x: 184, y: 8, w: 24, h: 24 }).count >= 400;
      return [near(h, 4, 1) && pinkButton, `赤の太さ ${h} 消しゴムのボタン ${pinkButton}`];
    }),
    await fresh(env, entry, data, seed, "thin-black-default", "retain", async () => {
      await line(100);
      const h = strokeHeight(await env.shot(), 200, BLACK, 60, 140);
      return [near(h, 4, 1), `太さ ${h}`];
    }),
    await fresh(env, entry, data, seed, "select-blue", "retain", async () => {
      await env.click(84, 20);
      await env.advance(16);
      await line(300);
      const s = await env.shot();
      return [near(strokeHeight(s, 200, BLUE, 280, 320), 4, 1) && strokeHeight(s, 200, BLACK, 280, 320) === 0, `青 ${strokeHeight(s, 200, BLUE, 280, 320)}`];
    }),
  ];
};

// =============== G-R1 一時停止と残り時間 ===============
const pauseTimer: Check = async (env, entry, data, seed) => {
  const bar = (s: Shot) => blob(s, WHITE, 30, { x: 0, y: 350, w: 480, h: 10 });
  const icon = (s: Shot) => blob(s, WHITE, 30, { x: 190, y: 130, w: 100, h: 100 }).count;
  const enemies = (s: Shot) => components(s, RED, 30, undefined, 100).sort((a, b) => a.cx - b.cx);
  return [
    await fresh(env, entry, data, seed, "timer-stops-while-paused", "change", async () => {
      await env.advance(1500);
      const w1 = bar(await env.shot()).box?.w;
      await env.press("KeyP");
      await env.advance(5000);
      const w2 = bar(await env.shot()).box?.w;
      await env.press("KeyP");
      await env.advance(500);
      const w3 = bar(await env.shot()).box?.w;
      return [near(w1, 456, 4) && near(w2, w1 ?? NaN, 3) && near(w3, (w1 ?? NaN) - 8, 4), `1.5 秒 ${w1} 停止 5 秒後 ${w2} 再開 0.5 秒後 ${w3}`];
    }),
    await fresh(env, entry, data, seed, "no-timeout-from-paused-time", "change", async () => {
      await env.advance(1000);
      await env.press("KeyP");
      await env.advance(29500);
      await env.press("KeyP");
      await env.advance(200);
      const s = await env.shot();
      const w = bar(s).box?.w;
      return [!covers(s, CLEAR, 0.3) && !isGameOver(s) && near(w, 460.8, 5), `停止 29.5 秒・動作 1.2 秒でバー ${w}`];
    }),
    await fresh(env, entry, data, seed, "pause-freezes-enemies", "retain", async () => {
      await env.advance(1500);
      await env.press("KeyP");
      await env.advance(16);
      const s1 = await env.shot();
      const e1 = enemies(s1);
      await env.advance(1000);
      const s2 = await env.shot();
      const e2 = enemies(s2);
      const frozen = e1.length >= 1 && e1.length === e2.length && e1.every((e, i) => near(e2[i].cy, e.cy, 1) && near(e2[i].cx, e.cx, 1));
      await env.press("KeyP");
      await env.advance(300);
      const e3 = enemies(await env.shot());
      const moved = e3.some((e) => e1.some((f) => near(e.cx, f.cx, 1) && e.cy - f.cy >= 30));
      return [frozen && icon(s2) >= 400 && moved, `停止中 ${frozen} 印 ${icon(s2)} 再開で動く ${moved}`];
    }),
    await fresh(env, entry, data, seed, "move-arrows", "retain", async () => {
      const a = blob(await env.shot(), GREEN);
      await env.hold("ArrowRight", 300);
      const b = blob(await env.shot(), GREEN);
      return [!!a.box && near(b.cx - a.cx, 60, 10), `${f1(b.cx - a.cx)}`];
    }),
    await fresh(env, entry, data, seed, "collision-gameover-restart", "retain", async () => {
      for (let i = 0; i < 300; i++) {
        const s = await env.shot();
        if (isGameOver(s)) {
          await env.press("KeyR");
          await env.advance(50);
          const r = await env.shot();
          return [!isGameOver(r) && (bar(r).box?.w ?? 0) >= 470 && blob(r, GREEN).count >= 300, "衝突で終了、R で再開"];
        }
        const p = blob(s, GREEN), e = enemies(s).sort((a, b) => b.cy - a.cy)[0];
        if (p.box && e && Math.abs(e.cx - p.cx) > 4) await env.hold(e.cx > p.cx ? "ArrowRight" : "ArrowLeft", 48);
        else await env.advance(48);
      }
      return [false, "敵に当たってもゲームオーバーにならない"];
    }),
  ];
};

// =============== G-R2 ドラッグ ===============
const SLOT_C = [[112, 72, "#ff0000"], [240, 72, "#00ff00"], [368, 72, "#0080ff"]] as const;
const HOME_C: Record<string, [number, number]> = { "#0080ff": [112, 288], "#ff0000": [240, 288], "#00ff00": [368, 288] };
const box = (s: Shot, c: string) => components(s, hex(c), 30, undefined, 2000).filter((b) => near(b.box!.w, 56, 3) && near(b.box!.h, 56, 3))[0];
const dragBoxes: Check = async (env, entry, data, seed) => [
  await fresh(env, entry, data, seed, "fast-drag-follows", "change", async () => {
    await env.pointer(250, 298);
    await env.page.mouse.down();
    await env.advance(16);
    await mouseTo(env, 380, 148, 1);
    await env.advance(16);
    const a = box(await env.shot(), "#ff0000");
    await mouseTo(env, 300, 230, 1);
    await env.advance(16);
    const b = box(await env.shot(), "#ff0000");
    await env.page.mouse.up();
    await env.advance(16);
    const ok = !!a && !!b && near(a.cx, 370, 3) && near(a.cy, 138, 3) && near(b.cx, 290, 3) && near(b.cy, 220, 3);
    return [ok, `1 回目 ${a ? `${f1(a.cx)},${f1(a.cy)}` : "なし"} 2 回目 ${b ? `${f1(b.cx)},${f1(b.cy)}` : "なし"}`];
  }),
  await fresh(env, entry, data, seed, "slow-drag-snap", "retain", async () => {
    await drag(env, [[240, 288], [118, 80]], 30);
    const b = box(await env.shot(), "#ff0000");
    return [!!b && near(b.cx, 112, 2) && near(b.cy, 72, 2), b ? `${f1(b.cx)},${f1(b.cy)}` : "なし"];
  }),
  await fresh(env, entry, data, seed, "drop-outside-returns-home", "retain", async () => {
    await drag(env, [[368, 288], [240, 190]], 30);
    const b = box(await env.shot(), "#00ff00");
    return [!!b && near(b.cx, 368, 2) && near(b.cy, 288, 2), b ? `${f1(b.cx)},${f1(b.cy)}` : "なし"];
  }),
  await fresh(env, entry, data, seed, "sort-all-clear-restart", "retain", async () => {
    for (const [x, y, c] of SLOT_C) {
      const [hx, hy] = HOME_C[c];
      await drag(env, [[hx, hy], [x, y]], 40);
    }
    const s = await env.shot();
    const placed = SLOT_C.every(([x, y, c]) => { const b = box(s, c); return !!b && near(b.cx, x, 2) && near(b.cy, y, 2); });
    if (!placed || !covers(s, CLEAR, 0.3)) return [false, `枠に収まる ${placed} クリア背景 ${blob(s, CLEAR, 12).count}`];
    await env.press("KeyR");
    await env.advance(16);
    const r = await env.shot();
    const home = Object.entries(HOME_C).every(([c, [x, y]]) => { const b = box(r, c); return !!b && near(b.cx, x, 2) && near(b.cy, y, 2); });
    return [home && !covers(r, CLEAR, 0.1), "3 つそろえてクリア、R で元に戻る"];
  }),
];

// =============== G-V1 折れ線（補助線・ツールチップ・範囲の拡大） ===============
// 系列の点は他の系列の点・線に一部が隠れることがあるため、縦位置は ±4px で見る（横位置は ±2px）。
interface Monthly { months: string[]; series: { name: string; color: string; values: number[] }[] }
const chart: Check = async (env, entry, data, seed) => {
  const d = data as Monthly;
  const xm = (i: number, from = 0, to = 23) => 40 + ((i - from) * 400) / (to - from);
  const ym = (v: number) => 320 - v * 3;
  const markers = (s: Shot, k: number) =>
    components(s, hex(d.series[k].color), 24, { x: 30, y: 14, w: 420, h: 312 }, 10).filter((b) => b.box!.w >= 4 && b.box!.w <= 8 && b.box!.h >= 3 && b.box!.h <= 8).sort((a, b) => a.cx - b.cx);
  const guide = (s: Shot) => components(s, GRAY, 16, { x: 41, y: 14, w: 404, h: 312 }, 200).filter((b) => b.box!.w <= 3 && b.box!.h >= 250)[0];
  const tooltip = (s: Shot) => components(s, WHITE, 10, undefined, 1500).filter((b) => b.box!.w >= 80 && b.box!.h >= 30)[0];
  return [
    await fresh(env, entry, data, seed, "points-24", "retain", async () => {
      await env.advance(1000);
      const s = await env.shot();
      const a = markers(s, 0), b = markers(s, 1);
      const pos = a.length === 24 && a.every((m, i) => near(m.cx, xm(i), 2) && near(m.cy, ym(d.series[0].values[i]), 4));
      return [pos && b.length === 24, `系列 1 ${a.length} 点 系列 2 ${b.length} 点 位置 ${pos}`];
    }),
    await fresh(env, entry, data, seed, "hover-guide-tooltip", "change", async () => {
      await env.advance(1000);
      const px = Math.round(xm(10)), py = 170;
      await env.pointer(px, py);
      await env.advance(16);
      const s = await env.shot();
      const g = guide(s), t = tooltip(s);
      const inside = !!g && near(g.cx, xm(10), 2) && !!t && t.box!.x >= px - 2 && t.box!.y + t.box!.h <= py + 2;
      await env.pointer(470, 345);
      await env.advance(16);
      const o = await env.shot();
      const outside = !guide(o) && !tooltip(o);
      return [inside && outside, `中 縦線 ${g ? f1(g.cx) : "なし"} ツールチップ ${JSON.stringify(t?.box)} 外 ${outside}`];
    }),
    await fresh(env, entry, data, seed, "brush-zoom-and-reset", "change", async () => {
      await env.advance(1000);
      await drag(env, [[Math.round(xm(6)) - 3, 170], [Math.round(xm(12)) + 3, 170]], 15);
      await env.pointer(470, 345);
      await env.advance(16);
      const a = markers(await env.shot(), 0);
      const zoom = a.length === 7 && a.every((m, i) => near(m.cx, xm(i, 0, 6), 2) && near(m.cy, ym(d.series[0].values[6 + i]), 4));
      await env.press("KeyR");
      await env.advance(16);
      const b = markers(await env.shot(), 0);
      return [zoom && b.length === 24 && near(b[0].cx, 40, 2) && near(b[23].cx, 440, 2), `拡大 ${a.length} 点 ${a.map((m) => f1(m.cx)).join(",")} R ${b.length} 点`];
    }),
  ];
};

export const CHECKS: Record<string, Check> = {
  "G-N1-throw": throwGame,
  "G-N2-platforms": platforms,
  "G-N3-memory": memory,
  "G-N4-turret": turret,
  "G-M1-breakout": breakout,
  "G-M2-balls": balls,
  "G-M3-paint": paint,
  "G-R1-pause": pauseTimer,
  "G-R2-drag": dragBoxes,
  "G-V1-chart": chart,
};
