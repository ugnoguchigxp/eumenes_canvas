// テトリス（デモ用の固定応答。Grok Bot が制作担当を代行して作成）
canvasApp.start((api) => {
  const COLS = 10, ROWS = 20;
  const COLORS = { I: "#31c7ef", O: "#f7d308", T: "#ad4d9c", S: "#42b642", Z: "#ef2029", J: "#5a65ad", L: "#ef7921" };
  // 回転の箱（I は 4×4、O は 2×2、ほかは 3×3）の中のセル
  const SHAPES = {
    I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  };
  const KINDS = Object.keys(SHAPES);
  const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]];
  const LINE_SCORE = [0, 100, 300, 500, 800];
  const LOCK_MS = 500, MAX_RESETS = 15;

  let board, piece, next, bag, score, lines, level, over, paused, fallAcc, lockAcc, resets, seq, flash;

  function refillBag() {
    const b = KINDS.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(api.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    bag.push(...b);
  }
  function takeKind() {
    if (bag.length < 2) refillBag();
    return bag.shift();
  }
  function makePiece(kind) {
    const s = SHAPES[kind];
    return { kind, n: s.n, cells: s.cells.map(([x, y]) => [x, y]), x: kind === "O" ? 4 : 3, y: 0 };
  }
  function reset() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    bag = []; score = 0; lines = 0; level = 1; over = false; paused = false;
    fallAcc = 0; lockAcc = 0; resets = 0; seq = 0; flash = 0;
    next = takeKind();
    spawn();
  }
  function spawn() {
    piece = makePiece(next);
    next = takeKind();
    fallAcc = 0; lockAcc = 0; resets = 0;
    if (collides(piece.cells, piece.x, piece.y)) over = true;
    report();
  }
  function report() {
    api.status({
      game: "tetris", seq: ++seq, kind: piece.kind, n: piece.n, shape: piece.cells, x: piece.x, y: piece.y,
      board: board.map((r) => r.map((c) => (c ? "#" : ".")).join("")), lines, score, level, over,
    });
  }
  function collides(cells, px, py) {
    for (const [x, y] of cells) {
      const cx = px + x, cy = py + y;
      if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
      if (cy >= 0 && board[cy][cx]) return true;
    }
    return false;
  }
  function grounded() { return collides(piece.cells, piece.x, piece.y + 1); }
  function touched() {
    // 接地中の移動・回転は固定までの猶予をやり直す（回数に上限）
    if (grounded() && resets < MAX_RESETS) { lockAcc = 0; resets++; }
  }
  function rotate(dir) {
    if (piece.kind === "O") return;
    const n = piece.n;
    const rotated = piece.cells.map(([x, y]) => (dir > 0 ? [n - 1 - y, x] : [y, n - 1 - x]));
    for (const [kx, ky] of KICKS) {
      if (!collides(rotated, piece.x + kx, piece.y + ky)) {
        piece.cells = rotated; piece.x += kx; piece.y += ky; touched(); return;
      }
    }
  }
  function move(dx) {
    if (!collides(piece.cells, piece.x + dx, piece.y)) { piece.x += dx; touched(); }
  }
  function softDrop() {
    if (!grounded()) { piece.y++; score += 1; fallAcc = 0; }
  }
  function hardDrop() {
    let d = 0;
    while (!grounded()) { piece.y++; d++; }
    score += d * 2;
    lock();
  }
  function lock() {
    for (const [x, y] of piece.cells) {
      const cy = piece.y + y;
      if (cy < 0) { over = true; continue; }
      board[cy][piece.x + x] = piece.kind;
    }
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r].every(Boolean)) { board.splice(r, 1); board.unshift(Array(COLS).fill(null)); cleared++; r++; }
    }
    if (cleared) { score += LINE_SCORE[cleared] * level; lines += cleared; level = 1 + Math.floor(lines / 10); flash = 250; }
    if (over) { report(); return; }
    spawn();
  }
  function gravityMs() { return Math.max(60, 800 - (level - 1) * 70); }
  function ghostY() {
    let y = piece.y;
    while (!collides(piece.cells, piece.x, y + 1)) y++;
    return y;
  }

  reset();

  function layout() {
    const cell = Math.max(6, Math.floor(Math.min((api.width - 24) / (COLS + 7), (api.height - 24) / ROWS)));
    const bw = cell * COLS, bh = cell * ROWS;
    const ox = Math.floor((api.width - bw - cell * 7) / 2), oy = Math.floor((api.height - bh) / 2);
    return { cell, ox, oy, bw, bh, px: ox + bw + cell };
  }
  function block(c, x, y, s, color) {
    c.fillStyle = color; c.fillRect(x + 1, y + 1, s - 2, s - 2);
    c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(x + 1, y + 1, s - 2, Math.max(1, Math.floor(s / 6)));
  }

  return {
    frame(t, dt) {
      if (!over && !paused) {
        if (grounded()) {
          lockAcc += dt;
          if (lockAcc >= LOCK_MS) lock();
        } else {
          fallAcc += dt;
          while (fallAcc >= gravityMs() && !grounded()) { fallAcc -= gravityMs(); piece.y++; }
          if (grounded()) fallAcc = 0;
        }
      }
      if (flash > 0) flash = Math.max(0, flash - dt);
      const c = api.ctx, L = layout();
      c.fillStyle = "#14141e"; c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = flash > 0 ? "#202838" : "#000000"; c.fillRect(L.ox, L.oy, L.bw, L.bh);
      c.strokeStyle = "#1c1c28"; c.lineWidth = 1;
      for (let q = 1; q < COLS; q++) { c.beginPath(); c.moveTo(L.ox + q * L.cell + 0.5, L.oy); c.lineTo(L.ox + q * L.cell + 0.5, L.oy + L.bh); c.stroke(); }
      for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
        const k = board[r][q];
        if (k) block(c, L.ox + q * L.cell, L.oy + r * L.cell, L.cell, COLORS[k]);
      }
      if (!over) {
        const gy = ghostY();
        c.strokeStyle = COLORS[piece.kind]; c.globalAlpha = 0.5;
        for (const [x, y] of piece.cells) if (gy + y >= 0) c.strokeRect(L.ox + (piece.x + x) * L.cell + 1.5, L.oy + (gy + y) * L.cell + 1.5, L.cell - 3, L.cell - 3);
        c.globalAlpha = 1;
        for (const [x, y] of piece.cells) if (piece.y + y >= 0) block(c, L.ox + (piece.x + x) * L.cell, L.oy + (piece.y + y) * L.cell, L.cell, COLORS[piece.kind]);
      }
      const fs = Math.max(10, Math.floor(L.cell * 0.75));
      c.fillStyle = "#ffffff"; c.font = fs + "px sans-serif"; c.textBaseline = "top";
      c.fillText("NEXT", L.px, L.oy);
      const ns = SHAPES[next], sc = Math.floor(L.cell * 0.8);
      for (const [x, y] of ns.cells) block(c, L.px + x * sc, L.oy + fs * 1.6 + y * sc, sc, COLORS[next]);
      const ty = L.oy + fs * 1.6 + sc * 3;
      c.fillStyle = "#ffffff";
      c.fillText("SCORE", L.px, ty); c.fillText(String(score), L.px, ty + fs * 1.2);
      c.fillText("LEVEL " + level, L.px, ty + fs * 2.8);
      c.fillText("LINES " + lines, L.px, ty + fs * 4.2);
      c.fillStyle = "#9090a0"; c.font = Math.max(9, Math.floor(fs * 0.7)) + "px sans-serif";
      ["←→ 移動", "↑/X 右回転  Z 左回転", "↓ ソフト  Space ハード", "P 一時停止  R 最初から"].forEach((s, i) => c.fillText(s, L.px, ty + fs * 6 + i * fs * 1.05));
      if (paused && !over) {
        c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(L.ox, L.oy, L.bw, L.bh);
        c.fillStyle = "#ffffff"; c.font = fs + "px sans-serif"; c.fillText("一時停止中（P）", L.ox + 8, L.oy + L.bh / 2);
      }
      if (over) {
        c.fillStyle = "rgba(60,0,0,0.85)"; c.fillRect(L.ox, L.oy, L.bw, L.bh);
        c.fillStyle = "#ffffff"; c.font = Math.floor(fs * 1.2) + "px sans-serif";
        c.fillText("GAME OVER", L.ox + 8, L.oy + L.bh / 2 - fs * 1.5);
        c.font = fs + "px sans-serif";
        c.fillText("SCORE " + score, L.ox + 8, L.oy + L.bh / 2);
        c.fillText("R かクリックで再開", L.ox + 8, L.oy + L.bh / 2 + fs * 1.5);
      }
    },
    input(ev) {
      if (ev.type === "pointerdown") { if (over) reset(); return; }
      if (ev.type !== "keydown") return;
      if (ev.code === "KeyR" || (over && (ev.code === "Enter" || ev.code === "Space"))) { reset(); return; }
      if (over) return;
      if (ev.code === "KeyP") { paused = !paused; return; }
      if (paused) return;
      if (ev.code === "ArrowLeft") move(-1);
      else if (ev.code === "ArrowRight") move(1);
      else if (ev.code === "ArrowUp" || ev.code === "KeyX") rotate(1);
      else if (ev.code === "KeyZ") rotate(-1);
      else if (ev.code === "ArrowDown") softDrop();
      else if (ev.code === "Space") hardDrop();
    },
  };
});
