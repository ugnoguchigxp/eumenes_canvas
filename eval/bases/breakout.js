// ブロック崩し：ポインターの横位置でパドルを動かし、ボールでブロックを壊す。
canvasApp.start((api) => {
  const COLS = 8, BW = 50, BH = 14, LEFT = 20, PITCH_X = 56, TOP = 40, PITCH_Y = 20;
  const ROW_COLORS = ["#ff0000", "#ff8000", "#ff00ff"];
  const BALL_SPEED = 240; // px/s
  const PW = 80, PH = 10, PADDLE_BOTTOM = 30;
  let blocks, ball, paddleX, score, over;

  function reset() {
    blocks = [];
    for (let r = 0; r < ROW_COLORS.length; r++)
      for (let c = 0; c < COLS; c++) blocks.push({ x: LEFT + c * PITCH_X, y: TOP + r * PITCH_Y, color: ROW_COLORS[r] });
    const v = BALL_SPEED / Math.SQRT2;
    ball = { x: 240, y: 300, vx: v, vy: -v };
    paddleX = api.width / 2;
    score = 0;
    over = false;
  }
  reset();

  function update(s) {
    if (over) return;
    const W = api.width, H = api.height;
    ball.x += ball.vx * s;
    ball.y += ball.vy * s;
    if (ball.x < 4) { ball.x = 4; ball.vx = Math.abs(ball.vx); }
    if (ball.x > W - 4) { ball.x = W - 4; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < 4) { ball.y = 4; ball.vy = Math.abs(ball.vy); }
    const py = H - PADDLE_BOTTOM - PH;
    if (ball.vy > 0 && ball.y + 4 >= py && ball.y + 4 <= py + PH + 8 && Math.abs(ball.x - paddleX) <= PW / 2 + 4) {
      const off = Math.max(-1, Math.min(1, (ball.x - paddleX) / (PW / 2)));
      const sp = Math.hypot(ball.vx, ball.vy);
      const ang = (off * Math.PI) / 3;
      ball.vx = sp * Math.sin(ang);
      ball.vy = -sp * Math.cos(ang);
      ball.y = py - 4;
    }
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (ball.x + 4 > b.x && ball.x - 4 < b.x + BW && ball.y + 4 > b.y && ball.y - 4 < b.y + BH) {
        blocks.splice(i, 1);
        ball.vy = -ball.vy;
        score++;
        break;
      }
    }
    if (ball.y - 4 > H) over = true;
  }

  function drawScore(c) {
    c.fillStyle = "#ffff00";
    for (let i = 0; i < score; i++) c.fillRect(8 + i * 12, 4, 8, 8);
  }

  return {
    frame(t, dt) {
      if (dt > 0) update(dt / 1000);
      const c = api.ctx, W = api.width, H = api.height;
      if (over) {
        c.fillStyle = "#400000";
        c.fillRect(0, 0, W, H);
        drawScore(c);
        c.fillStyle = "#ffffff";
        c.font = "20px sans-serif";
        c.fillText("GAME OVER", W / 2 - 60, H / 2);
        return;
      }
      c.fillStyle = "#000000";
      c.fillRect(0, 0, W, H);
      for (const b of blocks) { c.fillStyle = b.color; c.fillRect(b.x, b.y, BW, BH); }
      c.fillStyle = "#00ff00";
      c.fillRect(paddleX - PW / 2, H - PADDLE_BOTTOM - PH, PW, PH);
      c.fillStyle = "#ffffff";
      c.fillRect(ball.x - 4, ball.y - 4, 8, 8);
      drawScore(c);
    },
    input(ev) {
      if (ev.type === "pointermove" || ev.type === "pointerdown") paddleX = Math.max(PW / 2, Math.min(api.width - PW / 2, ev.x));
      if (ev.type === "pointerdown" && over) reset();
    },
  };
});
