// 未使用課題の元作品：スネーク（不具合入り。評価担当が凍結）
canvasApp.start((api) => {
  const GW = 24, GH = 18;
  const STEP_MS = 150;
  let snake, dir, nextDir, food, score, over, acc;
  const tickers = [];
  function reset() {
    snake = [{ x: 12, y: 9 }, { x: 11, y: 9 }, { x: 10, y: 9 }];
    dir = { x: 1, y: 0 }; nextDir = dir; score = 0; over = false;
    tickers.push({ acc: 0 });
    placeFood();
  }
  function placeFood() {
    for (;;) {
      const f = { x: Math.floor(api.random() * GW), y: 2 + Math.floor(api.random() * (GH - 2)) };
      if (!snake.some((s) => s.x === f.x && s.y === f.y)) { food = f; return; }
    }
  }
  function step() {
    dir = nextDir;
    const h = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (h.x < 0 || h.y < 0 || h.x >= GW || h.y >= GH || snake.some((s) => s.x === h.x && s.y === h.y)) { over = true; return; }
    snake.unshift(h);
    if (h.x === food.x && h.y === food.y) { score++; placeFood(); } else snake.pop();
  }
  reset();
  return {
    frame(t, dt) {
      if (!over) for (const tk of tickers) { tk.acc += dt; while (tk.acc >= STEP_MS && !over) { tk.acc -= STEP_MS; step(); } }
      const c = api.ctx, cell = Math.floor(Math.min(api.width / GW, api.height / GH));
      const ox = Math.floor((api.width - cell * GW) / 2), oy = Math.floor((api.height - cell * GH) / 2);
      c.fillStyle = "#000000"; c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = "#ff0000"; c.fillRect(ox + food.x * cell + 2, oy + food.y * cell + 2, cell - 4, cell - 4);
      snake.forEach((s, i) => { c.fillStyle = i === 0 ? "#80ff80" : "#00c000"; c.fillRect(ox + s.x * cell + 1, oy + s.y * cell + 1, cell - 2, cell - 2); });
      c.fillStyle = "#ffff00";
      for (let i = 0; i < Math.min(score, 40); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, api.width, api.height); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("GAME OVER  R で再開", 20, api.height / 2); }
    },
    input(ev) {
      if (ev.type !== "keydown") return;
      if (ev.code === "KeyR" || (over && ev.code === "Space")) { reset(); return; }
      const m = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } }[ev.code];
      if (m && !(m.x === -dir.x && m.y === -dir.y)) nextDir = m;
    },
  };
});
