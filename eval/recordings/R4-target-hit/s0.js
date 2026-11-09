// 的当て（当たり判定を修正）
canvasApp.start((api) => {
  const RADIUS = 20, TIME_MS = 30000;
  let target, score, left, over, overAt;
  function place() { target = { x: RADIUS + api.random() * (api.width - 2 * RADIUS), y: 30 + RADIUS + api.random() * (api.height - 60 - 2 * RADIUS) }; }
  function reset() { score = 0; left = TIME_MS; over = false; overAt = 0; place(); }
  reset();
  let now = 0;
  return {
    frame(t, dt) {
      now = t;
      if (!over) { left -= dt; if (left <= 0) { left = 0; over = true; overAt = t; } }
      const c = api.ctx, W = api.width, H = api.height;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ff00ff"; c.beginPath(); c.arc(target.x, target.y, RADIUS, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(score, 40); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      c.fillStyle = "#ffffff"; c.fillRect(0, H - 6, (W * left) / TIME_MS, 6);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("TIME UP  クリックで再開", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keydown" && ev.code === "Space" && over) { reset(); return; }
      if (ev.type !== "pointerdown") return;
      if (over) { if (now - overAt >= 500) reset(); return; }
      if (Math.hypot(ev.x - target.x, ev.y - target.y) <= RADIUS) { score++; place(); }
    },
  };
});
