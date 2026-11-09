// 未使用課題の元作品：ポン（評価担当が凍結）
canvasApp.start((api) => {
  const PW = 10, PH = 60, BALL = 10, WIN = 5;
  let py, cy, ball, ps, cs, over, keys = {}, serveWait;
  function serve(towardPlayer) {
    ball = { x: api.width / 2, y: api.height / 2, vx: towardPlayer ? -0.25 : 0.25, vy: 0.08 };
    serveWait = 500;
  }
  function reset() { py = api.height / 2; cy = api.height / 2; ps = 0; cs = 0; over = false; serve(true); }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height;
      if (!over) {
        const dy = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
        py = Math.max(PH / 2, Math.min(H - PH / 2, py + dy * 0.3 * dt));
        const target = ball.y, d = target - cy;
        cy = Math.max(PH / 2, Math.min(H - PH / 2, cy + Math.sign(d) * Math.min(Math.abs(d), 0.12 * dt)));
        if (serveWait > 0) serveWait -= dt;
        else {
          const n = Math.ceil(dt / 4);
          for (let i = 0; i < n; i++) {
            const s = dt / n;
            ball.x += ball.vx * s; ball.y += ball.vy * s;
            if (ball.y < BALL / 2) { ball.y = BALL / 2; ball.vy = Math.abs(ball.vy); }
            if (ball.y > H - BALL / 2) { ball.y = H - BALL / 2; ball.vy = -Math.abs(ball.vy); }
            // プレイヤー側（左）の衝突
            if (ball.vx < 0 && ball.x - BALL / 2 <= 20 + PW && ball.x - BALL / 2 >= 20 && Math.abs(ball.y - py) <= PH / 2 + BALL / 2) { ball.vx = Math.abs(ball.vx); ball.vy += (ball.y - py) * 0.002; }
            // CPU 側（右）の衝突
            if (ball.vx > 0 && ball.x + BALL / 2 >= W - 20 - PW && ball.x + BALL / 2 <= W - 20 && Math.abs(ball.y - cy) <= PH / 2 + BALL / 2) { ball.vx = -Math.abs(ball.vx); }
            if (ball.x < -BALL) { cs++; if (cs >= WIN) over = true; else serve(true); break; }
            if (ball.x > W + BALL) { ps++; if (ps >= WIN) over = true; else serve(false); break; }
          }
        }
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#404040"; for (let y = 0; y < H; y += 20) c.fillRect(W / 2 - 1, y, 2, 10);
      c.fillStyle = "#ffffff"; c.fillRect(20, py - PH / 2, PW, PH); c.fillRect(W - 20 - PW, cy - PH / 2, PW, PH);
      c.fillRect(ball.x - BALL / 2, ball.y - BALL / 2, BALL, BALL);
      c.fillStyle = "#ffff00"; for (let i = 0; i < ps; i++) c.fillRect(4 + i * 10, 4, 8, 8);
      c.fillStyle = "#00ffff"; for (let i = 0; i < cs; i++) c.fillRect(W - 12 - i * 10, 4, 8, 8);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("GAME OVER  R で再開", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keydown") { keys[ev.code] = true; if (ev.code === "KeyR" || (over && ev.code === "Space")) reset(); }
      if (ev.type === "keyup") keys[ev.code] = false;
    },
  };
});
