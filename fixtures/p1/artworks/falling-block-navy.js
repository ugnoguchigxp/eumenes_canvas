// 落ち物ゲーム：背景を紺色に変更（調整用・P1 固定応答）
canvasApp.start((api) => {
  const COLS = 10, ROWS = 20;
  const DROP_MS = 800;
  const COLORS = { I: "#00f0f0", O: "#f0f000", T: "#a000f0", S: "#00f000", Z: "#f00000", J: "#0000f0", L: "#f0a000" };
  const SHAPES = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]],
    O: [[1, 0], [2, 0], [1, 1], [2, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  };
  const KINDS = Object.keys(SHAPES);
  let board, piece, acc, score, lines, over;

  function reset() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    score = 0; lines = 0; acc = 0; over = false;
    spawn();
  }
  function spawn() {
    const kind = KINDS[Math.floor(api.random() * KINDS.length)];
    piece = { kind, cells: SHAPES[kind].map(([x, y]) => [x, y]), x: 3, y: 0 };
    if (collides(piece.cells, piece.x, piece.y)) over = true;
  }
  function collides(cells, px, py) {
    return cells.some(([x, y]) => {
      const cx = px + x, cy = py + y;
      return cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && board[cy][cx]);
    });
  }
  function rotate() {
    if (piece.kind === "O") return;
    const rotated = piece.cells.map(([x, y]) => [2 - y, x]);
    for (const kick of [0, -1, 1]) {
      if (!collides(rotated, piece.x + kick, piece.y)) { piece.cells = rotated; piece.x += kick; return; }
    }
  }
  function lock() {
    for (const [x, y] of piece.cells) if (piece.y + y >= 0) board[piece.y + y][piece.x + x] = piece.kind;
    let cleared = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r].every(Boolean)) { board.splice(r, 1); board.unshift(Array(COLS).fill(null)); cleared++; r++; }
    }
    lines += cleared;
    score += cleared * 100;
    spawn();
  }
  function step() {
    if (!collides(piece.cells, piece.x, piece.y + 1)) piece.y++;
    else lock();
  }
  function move(dx) {
    if (!collides(piece.cells, piece.x + dx, piece.y)) piece.x += dx;
  }

  reset();

  function layout() {
    const cell = Math.max(4, Math.floor(Math.min((api.width - 20) / (COLS + 6), (api.height - 20) / ROWS)));
    const bw = cell * COLS, bh = cell * ROWS;
    const ox = Math.floor((api.width - bw - cell * 6) / 2), oy = Math.floor((api.height - bh) / 2);
    return { cell, ox, oy, bw, bh };
  }

  return {
    frame(t, dt) {
      if (!over) {
        acc += dt;
        while (acc >= DROP_MS && !over) { acc -= DROP_MS; step(); }
      }
      const c = api.ctx, L = layout();
      c.fillStyle = "#000040"; c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = "#000000"; c.fillRect(L.ox, L.oy, L.bw, L.bh);
      for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
        const k = board[r][q];
        if (k) { c.fillStyle = COLORS[k]; c.fillRect(L.ox + q * L.cell + 1, L.oy + r * L.cell + 1, L.cell - 2, L.cell - 2); }
      }
      if (!over) {
        c.fillStyle = COLORS[piece.kind];
        for (const [x, y] of piece.cells) if (piece.y + y >= 0) c.fillRect(L.ox + (piece.x + x) * L.cell + 1, L.oy + (piece.y + y) * L.cell + 1, L.cell - 2, L.cell - 2);
      }
      c.fillStyle = "#ffffff"; c.font = Math.max(10, Math.floor(L.cell * 0.8)) + "px sans-serif"; c.textBaseline = "top";
      c.fillText("SCORE", L.ox + L.bw + L.cell, L.oy);
      c.fillText(String(score), L.ox + L.bw + L.cell, L.oy + L.cell * 1.2);
      c.fillText("LINES " + lines, L.ox + L.bw + L.cell, L.oy + L.cell * 3);
      if (over) {
        c.fillStyle = "rgba(64,0,0,0.85)"; c.fillRect(0, 0, api.width, api.height);
        c.fillStyle = "#ffffff"; c.fillText("GAME OVER  R で再開", 10, api.height / 2);
      }
    },
    input(ev) {
      if (ev.type === "pointerdown" && over) { reset(); return; }
      if (ev.type !== "keydown") return;
      if (ev.code === "KeyR") { reset(); return; }
      if (over) return;
      if (ev.code === "ArrowLeft") move(-1);
      else if (ev.code === "ArrowRight") move(1);
      else if (ev.code === "ArrowUp") rotate();
      else if (ev.code === "ArrowDown") step();
      else if (ev.code === "Space") { while (!collides(piece.cells, piece.x, piece.y + 1)) piece.y++; lock(); }
    },
  };
});
