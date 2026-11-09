// オセロ（デモ用の固定応答。Grok Bot が制作担当を代行して作成）
canvasApp.start((api) => {
  const N = 8, EMPTY = 0, BLACK = 1, WHITE = 2;
  const HUMAN = BLACK, CPU = WHITE;
  const CPU_DELAY = 600;
  // 位置の重み（角を高く、角の隣を低く）
  const W = [
    [100, -20, 10, 5, 5, 10, -20, 100],
    [-20, -50, -2, -2, -2, -2, -50, -20],
    [10, -2, 1, 1, 1, 1, -2, 10],
    [5, -2, 1, 0, 0, 1, -2, 5],
    [5, -2, 1, 0, 0, 1, -2, 5],
    [10, -2, 1, 1, 1, 1, -2, 10],
    [-20, -50, -2, -2, -2, -2, -50, -20],
    [100, -20, 10, 5, 5, 10, -20, 100],
  ];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let board, turn, over, cpuWait, message, last, cursor, seq, hover;

  function reset() {
    board = Array.from({ length: N }, () => Array(N).fill(EMPTY));
    board[3][3] = WHITE; board[4][4] = WHITE; board[3][4] = BLACK; board[4][3] = BLACK;
    turn = BLACK; over = false; cpuWait = 0; message = "あなた（黒）の番です"; last = null; cursor = [2, 3]; seq = 0; hover = null;
    report();
  }
  const other = (p) => (p === BLACK ? WHITE : BLACK);
  function flipsFor(b, x, y, p) {
    if (b[y][x] !== EMPTY) return [];
    const out = [];
    for (const [dx, dy] of DIRS) {
      const line = [];
      let cx = x + dx, cy = y + dy;
      while (cx >= 0 && cx < N && cy >= 0 && cy < N && b[cy][cx] === other(p)) { line.push([cx, cy]); cx += dx; cy += dy; }
      if (line.length && cx >= 0 && cx < N && cy >= 0 && cy < N && b[cy][cx] === p) out.push(...line);
    }
    return out;
  }
  function legalMoves(b, p) {
    const m = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (flipsFor(b, x, y, p).length) m.push([x, y]);
    return m;
  }
  function count(p) { let n = 0; for (const r of board) for (const v of r) if (v === p) n++; return n; }
  function place(x, y, p) {
    const f = flipsFor(board, x, y, p);
    if (!f.length) return false;
    board[y][x] = p;
    for (const [fx, fy] of f) board[fy][fx] = p;
    last = [x, y];
    advanceTurn(p);
    return true;
  }
  function advanceTurn(justMoved) {
    const nxt = other(justMoved);
    if (legalMoves(board, nxt).length) {
      turn = nxt;
      message = nxt === HUMAN ? "あなた（黒）の番です" : "CPU（白）が考えています…";
    } else if (legalMoves(board, justMoved).length) {
      turn = justMoved;
      message = (nxt === HUMAN ? "あなた" : "CPU") + "は置ける場所がないのでパスです";
    } else {
      over = true;
      const b = count(BLACK), w = count(WHITE);
      message = b > w ? `あなたの勝ち（${b} 対 ${w}）` : b < w ? `CPU の勝ち（${b} 対 ${w}）` : `引き分け（${b} 対 ${w}）`;
    }
    if (turn === CPU && !over) cpuWait = CPU_DELAY;
    report();
  }
  function cpuMove() {
    const moves = legalMoves(board, CPU);
    if (!moves.length) return;
    let best = null, bestScore = -Infinity;
    for (const [x, y] of moves) {
      const f = flipsFor(board, x, y, CPU);
      // 置いた後に相手が角を取れるなら減点
      const nb = board.map((r) => r.slice());
      nb[y][x] = CPU; for (const [fx, fy] of f) nb[fy][fx] = CPU;
      const oppCorner = legalMoves(nb, HUMAN).some(([ox, oy]) => (ox === 0 || ox === N - 1) && (oy === 0 || oy === N - 1));
      const s = W[y][x] * 3 + f.length - (oppCorner ? 60 : 0) + api.random() * 0.5;
      if (s > bestScore) { bestScore = s; best = [x, y]; }
    }
    place(best[0], best[1], CPU);
  }
  function report() {
    api.status({
      game: "othello", seq: ++seq, turn: turn === BLACK ? "black" : "white", black: count(BLACK), white: count(WHITE), over, message,
      legal: !over && turn === HUMAN ? legalMoves(board, HUMAN) : [], board: board.map((r) => r.map((v) => ".BW"[v]).join("")), layout: layout(),
    });
  }
  function layout() {
    const side = Math.max(120, Math.min(api.width - 24, api.height - 48 - 24));
    const cell = Math.floor(side / N);
    const bs = cell * N;
    const ox = Math.floor((api.width - bs) / 2), oy = 48 + Math.max(0, Math.floor((api.height - 48 - 24 - bs) / 2));
    return { ox, oy, cell, size: bs };
  }
  function cellAt(px, py) {
    const L = layout();
    const x = Math.floor((px - L.ox) / L.cell), y = Math.floor((py - L.oy) / L.cell);
    return x >= 0 && x < N && y >= 0 && y < N ? [x, y] : null;
  }
  function humanAt(x, y) {
    if (over || turn !== HUMAN) return;
    if (!place(x, y, HUMAN)) { message = "そこには置けません（点の場所に置けます）"; report(); }
  }

  reset();

  return {
    frame(t, dt) {
      if (!over && turn === CPU) {
        cpuWait -= dt;
        if (cpuWait <= 0) cpuMove();
      }
      const c = api.ctx, L = layout();
      c.fillStyle = "#1d2a22"; c.fillRect(0, 0, api.width, api.height);
      const fs = Math.max(11, Math.floor(L.cell * 0.32));
      c.font = fs + "px sans-serif"; c.textBaseline = "middle";
      // 上部：石の数と手番
      c.fillStyle = "#000"; c.beginPath(); c.arc(L.ox + 10, 14, 8, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.fillText("あなた " + count(BLACK), L.ox + 24, 14);
      c.fillStyle = "#fff"; c.beginPath(); c.arc(L.ox + 130, 14, 8, 0, Math.PI * 2); c.fill();
      c.fillText("CPU " + count(WHITE), L.ox + 144, 14);
      c.fillStyle = over ? "#ffd75e" : "#d8e8d8"; c.fillText(message, L.ox, 34);
      // 盤
      c.fillStyle = "#2e8b57"; c.fillRect(L.ox, L.oy, L.size, L.size);
      c.strokeStyle = "#0f3d24"; c.lineWidth = 1;
      for (let i = 0; i <= N; i++) {
        c.beginPath(); c.moveTo(L.ox + i * L.cell + 0.5, L.oy); c.lineTo(L.ox + i * L.cell + 0.5, L.oy + L.size); c.stroke();
        c.beginPath(); c.moveTo(L.ox, L.oy + i * L.cell + 0.5); c.lineTo(L.ox + L.size, L.oy + i * L.cell + 0.5); c.stroke();
      }
      const legal = !over && turn === HUMAN ? legalMoves(board, HUMAN) : [];
      for (const [x, y] of legal) {
        const hot = hover && hover[0] === x && hover[1] === y;
        c.fillStyle = hot ? "rgba(0,0,0,0.45)" : "rgba(255,255,160,0.55)";
        c.beginPath(); c.arc(L.ox + (x + 0.5) * L.cell, L.oy + (y + 0.5) * L.cell, hot ? L.cell * 0.4 : L.cell * 0.12, 0, Math.PI * 2); c.fill();
      }
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = board[y][x];
        if (v === EMPTY) continue;
        c.fillStyle = v === BLACK ? "#111" : "#f4f4f4";
        c.beginPath(); c.arc(L.ox + (x + 0.5) * L.cell, L.oy + (y + 0.5) * L.cell, L.cell * 0.42, 0, Math.PI * 2); c.fill();
      }
      if (last) {
        c.fillStyle = "#e04040";
        c.beginPath(); c.arc(L.ox + (last[0] + 0.5) * L.cell, L.oy + (last[1] + 0.5) * L.cell, Math.max(2, L.cell * 0.07), 0, Math.PI * 2); c.fill();
      }
      if (!over && turn === HUMAN) {
        c.strokeStyle = "#ffd75e"; c.lineWidth = 2;
        c.strokeRect(L.ox + cursor[0] * L.cell + 2, L.oy + cursor[1] * L.cell + 2, L.cell - 4, L.cell - 4);
      }
      c.fillStyle = "#a8bca8"; c.font = Math.max(10, fs - 2) + "px sans-serif";
      c.fillText(over ? "R かクリックでもう一度" : "クリック、または矢印キー＋Enter で置く。R で最初から", L.ox, L.oy + L.size + 14);
    },
    input(ev) {
      if (ev.type === "pointermove") { hover = cellAt(ev.x, ev.y); return; }
      if (ev.type === "pointerdown") {
        if (over) { reset(); return; }
        const p = cellAt(ev.x, ev.y);
        if (p) { cursor = p; humanAt(p[0], p[1]); }
        return;
      }
      if (ev.type !== "keydown") return;
      if (ev.code === "KeyR") { reset(); return; }
      if (over) { if (ev.code === "Enter" || ev.code === "Space") reset(); return; }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.code];
      if (d) cursor = [Math.min(N - 1, Math.max(0, cursor[0] + d[0])), Math.min(N - 1, Math.max(0, cursor[1] + d[1]))];
      else if (ev.code === "Enter" || ev.code === "Space") humanAt(cursor[0], cursor[1]);
    },
  };
});
