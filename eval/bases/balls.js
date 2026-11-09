// ボールの落下：3 個のボールが重力で落ち、床と左右の壁ではね返る。
canvasApp.start((api) => {
  const GRAVITY = 800; // px/s²
  const R = 12;
  const BOUNCE = 0.85;
  const INITIAL = [
    { x: 120, y: 60, vx: 60, color: "#ff0000" },
    { x: 240, y: 100, vx: -40, color: "#00ff00" },
    { x: 360, y: 140, vx: 30, color: "#0080ff" },
  ];
  const balls = INITIAL.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: 0, color: b.color }));

  function step(b, s) {
    const W = api.width, H = api.height;
    b.vy += GRAVITY * s;
    b.x += b.vx * s;
    b.y += b.vy * s;
    if (b.y > H - R) {
      b.y = H - R;
      b.vy = -Math.abs(b.vy) * BOUNCE;
      if (Math.abs(b.vy) < 30) b.vy = 0;
    }
    if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); }
    if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); }
  }

  return {
    frame(t, dt) {
      if (dt > 0) for (const b of balls) step(b, dt / 1000);
      const c = api.ctx;
      c.fillStyle = "#000000";
      c.fillRect(0, 0, api.width, api.height);
      for (const b of balls) {
        c.fillStyle = b.color;
        c.beginPath();
        c.arc(b.x, b.y, R, 0, Math.PI * 2);
        c.fill();
      }
    },
  };
});
