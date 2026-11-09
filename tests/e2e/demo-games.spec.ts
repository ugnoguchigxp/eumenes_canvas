// デモの 4 作品（fixtures/demo）を共通プレビューで実際に遊ぶ。状態は作品の api.status（診断）から読む。
// DEMO_SHOTS にディレクトリを指定すると、各作品の画面を保存する。
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openHarness, start, advance, statuses } from "./support/harness";

const ART = join(process.cwd(), "fixtures/demo/artworks");
const entry = (f: string) => readFileSync(join(ART, f), "utf8");

async function latest(page: Page, game: string, after = 0, timeout = 3000): Promise<any> {
  const t0 = Date.now();
  for (;;) {
    const s = (await statuses(page)).filter((v) => v && v.game === game && v.seq > after);
    if (s.length) return s[s.length - 1];
    if (Date.now() - t0 > timeout) return null;
    await page.waitForTimeout(25);
  }
}
async function settle(page: Page) {
  const pf = page.frames().find((f) => f.url().includes("/shell.html"));
  if (pf) await pf.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}
async function shot(page: Page, name: string, browserName: string) {
  const dir = process.env.DEMO_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.locator("#frame").screenshot({ path: join(dir, `${name}-${browserName}.png`) });
}
async function boot(page: Page, file: string, title: string) {
  await openHarness(page);
  const r = await start(page, entry(file), { title });
  expect(r.type).toBe("ready");
  const errs = async () => (await page.evaluate(() => (window as any).harness.events.filter((e: any) => e.type === "error" || e.type === "violation")));
  return errs;
}

// ---- テトリス：盤面を読んで置き場所を選び、1 列以上消す ----
type Cell = [number, number];
function rotateCells(cells: Cell[], n: number): Cell[] {
  return cells.map(([x, y]) => [n - 1 - y, x]);
}
function evaluate(board: string[], cells: Cell[], px: number, py: number) {
  const H = board.length, Wd = board[0].length;
  const hit = (x: number, y: number) => cells.some(([cx, cy]) => { const X = x + cx, Y = y + cy; return X < 0 || X >= Wd || Y >= H || (Y >= 0 && board[Y][X] === "#"); });
  if (hit(px, py)) return null;
  let y = py;
  while (!hit(px, y + 1)) y++;
  const g = board.map((r) => [...r]);
  for (const [cx, cy] of cells) if (y + cy >= 0) g[y + cy][px + cx] = "#";
  const rows = g.filter((r) => !r.every((c) => c === "#"));
  const cleared = H - rows.length;
  let holes = 0, agg = 0, bump = 0, prev = -1;
  for (let x = 0; x < Wd; x++) {
    let top = rows.findIndex((r) => r[x] === "#");
    const h = top < 0 ? 0 : rows.length - top;
    if (top >= 0) for (let r = top + 1; r < rows.length; r++) if (rows[r][x] !== "#") holes++;
    agg += h;
    if (prev >= 0) bump += Math.abs(h - prev);
    prev = h;
  }
  return cleared * 8 - holes * 3.5 - agg * 0.5 - bump * 0.35;
}

test("テトリス：回転・移動・落下で 1 列以上消える", async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const errs = await boot(page, "tetris.js", "テトリス");
  await page.locator("#frame").click({ position: { x: 5, y: 5 } });
  let s = await latest(page, "tetris");
  expect(s).not.toBeNull();
  for (let i = 0; i < 80 && s.lines < 1 && !s.over; i++) {
    let best: { r: number; x: number; v: number } | null = null;
    let cells = s.shape as Cell[];
    for (let r = 0; r < (s.kind === "O" ? 1 : 4); r++) {
      for (let x = -3; x < 10; x++) {
        const v = evaluate(s.board, cells, x, s.y);
        if (v !== null && (!best || v > best.v)) best = { r, x, v };
      }
      cells = rotateCells(cells, s.n);
    }
    for (let k = 0; k < best!.r; k++) await page.keyboard.press("ArrowUp");
    const dx = best!.x - s.x;
    for (let k = 0; k < Math.abs(dx); k++) await page.keyboard.press(dx < 0 ? "ArrowLeft" : "ArrowRight");
    await page.keyboard.press("Space");
    const n = await latest(page, "tetris", s.seq);
    expect(n).not.toBeNull();
    s = n;
    await page.waitForTimeout(60); // 診断通知の頻度上限（毎秒 20 件）に収める
  }
  expect(s.over).toBe(false);
  expect(s.lines).toBeGreaterThanOrEqual(1);
  expect(s.score).toBeGreaterThanOrEqual(100);
  await advance(page, 400);
  await shot(page, "tetris", browserName);
  expect(await errs()).toEqual([]);
});

test("オセロ：合法手に置くと挟んだ石が返り、CPU が応じる", async ({ page, browserName }) => {
  const errs = await boot(page, "othello.js", "オセロ");
  let s = await latest(page, "othello");
  expect(s.legal.length).toBe(4); // 初期配置の黒の合法手
  for (let m = 0; m < 3; m++) {
    expect(s.turn).toBe("black");
    const [x, y] = s.legal[0];
    const before = s.black;
    const L = s.layout;
    await page.locator("#frame").click({ position: { x: L.ox + (x + 0.5) * L.cell, y: L.oy + (y + 0.5) * L.cell } });
    const placed = await latest(page, "othello", s.seq);
    expect(placed.board[y][x]).toBe("B");
    expect(placed.black).toBeGreaterThanOrEqual(before + 2); // 置いた 1 枚と、返した 1 枚以上
    await advance(page, 700); // CPU の手番
    s = await latest(page, "othello", placed.seq);
    if (s.over) break;
    expect(s.white).toBeGreaterThanOrEqual(placed.white + 2);
    await page.waitForTimeout(120);
  }
  // 置けない場所を押しても盤は変わらない
  const occupied = s.board[3][3] !== "." ? [3, 3] : [4, 4];
  const L = s.layout;
  await page.locator("#frame").click({ position: { x: L.ox + (occupied[0] + 0.5) * L.cell, y: L.oy + (occupied[1] + 0.5) * L.cell } });
  const after = await latest(page, "othello", s.seq);
  expect(after.board).toEqual(s.board);
  await shot(page, "othello", browserName);
  expect(await errs()).toEqual([]);
});

test("インベーダーゲーム：自機が動き、弾で敵を倒すと得点が入る", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const errs = await boot(page, "invaders.js", "インベーダーゲーム");
  await page.locator("#frame").click({ position: { x: 240, y: 340 } });
  await advance(page, 900); // 開始の表示が消えるまで
  await page.keyboard.down("ArrowLeft");
  await advance(page, 300);
  await page.keyboard.up("ArrowLeft");
  await settle(page);
  let kill = null;
  for (let i = 0; i < 80 && !kill; i++) {
    await page.keyboard.press("Space");
    await settle(page);
    await advance(page, 120);
    kill = (await statuses(page)).find((v) => v && v.game === "invaders" && v.event === "kill");
  }
  expect(kill).toBeTruthy();
  expect(kill.score).toBeGreaterThanOrEqual(10);
  expect(kill.alive).toBe(54);
  expect(kill.playerX).toBeLessThan(240); // ← で左へ動いた
  await advance(page, 200);
  await shot(page, "invaders", browserName);
  expect(await errs()).toEqual([]);
});

// ---- ソリティア：状態から合法手を探し、ドラッグで動かす ----
const RANK: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };
const card = (c: string) => ({ r: RANK[c.slice(0, -1)] ?? Number(c.slice(0, -1)), s: c.slice(-1), red: "HD".includes(c.slice(-1)) });
function findMove(s: any): { from: [number, number]; to: [number, number]; kind: string } | null {
  const L = s.layout;
  const center = (x: number, y: number): [number, number] => [x + L.cw / 2, y + Math.min(L.ch / 2, 10)];
  const tabTarget = (i: number): [number, number] => {
    const t = s.tab[i];
    const y = t.ys.length ? t.ys[t.ys.length - 1] : L.tabY;
    return [L.cols[i] + L.cw / 2, y + L.ch / 2];
  };
  const foundOk = (c: ReturnType<typeof card>, f: string | null) => (f ? card(f).s === c.s && c.r === card(f).r + 1 : c.r === 1);
  const tabOk = (c: ReturnType<typeof card>, i: number) => {
    const t = s.tab[i];
    if (!t.up.length) return t.down === 0 && c.r === 13;
    const tc = card(t.up[t.up.length - 1]);
    return tc.red !== c.red && c.r === tc.r - 1;
  };
  if (s.waste) {
    const c = card(s.waste);
    for (let f = 0; f < 4; f++) if (foundOk(c, s.found[f])) return { from: center(L.cols[1], L.topY), to: [L.cols[3 + f] + L.cw / 2, L.topY + L.ch / 2], kind: "waste→組札" };
    for (let i = 0; i < 7; i++) if (tabOk(c, i)) return { from: center(L.cols[1], L.topY), to: tabTarget(i), kind: "waste→場札" };
  }
  for (let i = 0; i < 7; i++) {
    const t = s.tab[i];
    if (!t.up.length) continue;
    const topCard = card(t.up[t.up.length - 1]);
    for (let f = 0; f < 4; f++) if (foundOk(topCard, s.found[f])) return { from: center(L.cols[i], t.ys[t.ys.length - 1]), to: [L.cols[3 + f] + L.cw / 2, L.topY + L.ch / 2], kind: "場札→組札" };
    for (let j = 0; j < t.up.length; j++) {
      const c = card(t.up[j]);
      if (c.r === 13 && j === 0 && t.down === 0) continue;
      for (let k = 0; k < 7; k++) if (k !== i && tabOk(c, k)) return { from: center(L.cols[i], t.ys[j]), to: tabTarget(k), kind: "場札→場札" };
    }
  }
  return null;
}

test("ソリティア：山札をめくり、合法手をドラッグで動かせる", async ({ page, browserName }) => {
  test.setTimeout(90_000);
  const errs = await boot(page, "solitaire.js", "ソリティア");
  let s = await latest(page, "solitaire");
  expect(s.tab.map((t: any) => t.down + t.up.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(s.stock).toBe(24);
  const box = (await page.locator("#frame").boundingBox())!;
  let done = 0;
  for (let i = 0; i < 60 && done < 2; i++) {
    const mv = findMove(s);
    if (!mv) {
      const L = s.layout;
      await page.locator("#frame").click({ position: { x: L.cols[0] + L.cw / 2, y: L.topY + L.ch / 2 } });
    } else {
      await page.mouse.move(box.x + mv.from[0], box.y + mv.from[1]);
      await page.mouse.down();
      for (let k = 1; k <= 6; k++) {
        await page.mouse.move(box.x + mv.from[0] + ((mv.to[0] - mv.from[0]) * k) / 6, box.y + mv.from[1] + ((mv.to[1] - mv.from[1]) * k) / 6);
        await settle(page);
      }
      await page.mouse.up();
    }
    const n = await latest(page, "solitaire", s.seq);
    expect(n).not.toBeNull();
    if (mv) {
      expect(n.moves).toBe(s.moves + 1);
      done++;
    }
    s = n;
    await page.waitForTimeout(60);
  }
  expect(done).toBe(2);
  await shot(page, "solitaire", browserName);
  // 1 手戻す
  await page.keyboard.press("KeyU");
  const u = await latest(page, "solitaire", s.seq);
  expect(u.moves).toBe(s.moves - 1);
  expect(await errs()).toEqual([]);
});

// ホストの観測（src/core/observer.ts）と同じ一定の入力列を、両ブラウザで当てる。
for (const [file, title] of [["tetris.js", "テトリス"], ["othello.js", "オセロ"], ["invaders.js", "インベーダーゲーム"], ["solitaire.js", "ソリティア"]] as const) {
  test(`${title}：ホストの観測と同じ入力列で、エラーなし・単色でない・描画が変わる`, async ({ page }) => {
    const { PNG } = await import("pngjs");
    const errs = await boot(page, file, title);
    const frame = page.locator("#frame");
    const grab = async () => PNG.sync.read(await frame.screenshot({ scale: "css" }));
    const diff = (a: any, b: any) => { let d = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) d++; return d; };
    const colors = (a: any) => { const set = new Set<number>(); for (let i = 0; i < a.data.length && set.size < 3; i += 16) set.add((a.data[i] << 16) | (a.data[i + 1] << 8) | a.data[i + 2]); return set.size; };
    const s0 = await grab();
    await advance(page, 1000);
    const s1 = await grab();
    await frame.click({ position: { x: 240, y: 180 } });
    for (const k of ["ArrowLeft", "ArrowRight", "ArrowUp", "Space"]) await page.keyboard.press(k);
    for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 6; gx++) await frame.click({ position: { x: 40 + gx * 80, y: 45 + gy * 90 } });
    await advance(page, 500);
    const s2 = await grab();
    expect(await errs()).toEqual([]);
    expect(colors(s2)).toBeGreaterThan(1);
    expect(diff(s0, s1) > 0 || diff(s1, s2) > 0).toBe(true);
  });
}
