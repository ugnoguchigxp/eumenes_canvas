// ブロック崩し（調整用・P1 固定応答）
canvasApp.start((api) => {
  const COLS = 8, ROWS = 5;
  const ROW_COLORS = ["#ff4040", "#ff9040", "#ffff40", "#40ff40", "#4080ff"];
  let bricks, paddleX, ball, held, score, lives, over, keys = {};
  function reset() {
    bricks = [];
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) bricks.push({ r, q, alive: true });
    paddleX = api.width / 2; score = 0; lives = 3; over = false; serve();
  }
  function serve() { held = true; ball = { x: paddleX, y: api.height - 42, vx: 0, vy: 0 }; }
  function launch() { if (held) { held = false; ball.vx = 0.18 * (api.random() < 0.5 ? -1 : 1); ball.vy = -0.3; } }
  function brickRect(b) {
    const w = api.width / COLS, h = 18;
    return { x: b.q * w + 2, y: 40 + b.r * (h + 4), w: w - 4, h };
  }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, PW = 80, PY = H - 30;
      if (!over) {
        if (keys.ArrowLeft) paddleX -= 0.4 * dt;
        if (keys.ArrowRight) paddleX += 0.4 * dt;
        paddleX = Math.max(PW / 2, Math.min(W - PW / 2, paddleX));
        if (held) { ball.x = paddleX; ball.y = PY - 8; }
        else {
          let steps = Math.ceil(dt / 4);
          for (let i = 0; i < steps; i++) {
            const d = dt / steps;
            ball.x += ball.vx * d; ball.y += ball.vy * d;
            if (ball.x < 6) { ball.x = 6; ball.vx = Math.abs(ball.vx); }
            if (ball.x > W - 6) { ball.x = W - 6; ball.vx = -Math.abs(ball.vx); }
            if (ball.y < 6) { ball.y = 6; ball.vy = Math.abs(ball.vy); }
            if (ball.vy > 0 && ball.y + 6 >= PY && ball.y + 6 <= PY + 10 && Math.abs(ball.x - paddleX) <= PW / 2 + 6) {
              ball.vy = -Math.abs(ball.vy); ball.vx = ((ball.x - paddleX) / (PW / 2)) * 0.3;
            }
            for (const b of bricks) {
              if (!b.alive) continue;
              const R = brickRect(b);
              if (ball.x + 6 > R.x && ball.x - 6 < R.x + R.w && ball.y + 6 > R.y && ball.y - 6 < R.y + R.h) {
                b.alive = false; ball.vy = -ball.vy; score += 10; break;
              }
            }
            if (ball.y > H + 10) { lives--; if (lives <= 0) over = true; else serve(); break; }
          }
          if (bricks.every((b) => !b.alive)) over = true;
        }
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      for (const b of bricks) if (b.alive) { const R = brickRect(b); c.fillStyle = ROW_COLORS[b.r]; c.fillRect(R.x, R.y, R.w, R.h); }
      c.fillStyle = "#ffffff"; c.fillRect(paddleX - PW / 2, PY, PW, 10);
      c.fillStyle = "#ffff00"; c.beginPath(); c.arc(ball.x, ball.y, 6, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#ffffff"; c.font = "14px sans-serif"; c.textBaseline = "top";
      c.fillText("SCORE " + score + "  LIVES " + lives, 8, 10);
      if (over) { c.fillStyle = "rgba(64,0,0,0.85)"; c.fillRect(0, 0, W, H); c.fillStyle = "#fff"; c.fillText("GAME OVER  クリックで再開", 10, H / 2); }
    },
    input(ev) {
      if (ev.type === "pointermove") paddleX = ev.x;
      if (ev.type === "pointerdown") { if (over) reset(); else launch(); }
      if (ev.type === "keydown") { keys[ev.code] = true; if (ev.code === "Space") { if (over) reset(); else launch(); } }
      if (ev.type === "keyup") keys[ev.code] = false;
    },
    resize() { if (held) serve(); },
  };
});
