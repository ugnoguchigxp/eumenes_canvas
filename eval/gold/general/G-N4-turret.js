canvasApp.start((api) => {
  const W = () => api.width, H = () => api.height;
  const COOL = 800, SPEED = 400, LIMIT = 20000;
  let bullets, enemy, score, cool, elapsed, over, aim;
  const newEnemy = () => ({ x: 40 + api.random() * 400, y: 40 + api.random() * 120 });
  function reset() { bullets = []; enemy = newEnemy(); score = 0; cool = 0; elapsed = 0; over = false; aim = null; }
  reset();
  function update(dt) {
    if (over) return;
    const s = dt / 1000;
    elapsed += dt; cool = Math.max(0, cool - dt);
    for (const b of bullets) { b.x += b.vx * s; b.y += b.vy * s; }
    bullets = bullets.filter((b) => {
      if (b.x + 3 > enemy.x && b.x - 3 < enemy.x + 24 && b.y + 3 > enemy.y && b.y - 3 < enemy.y + 24) { score++; enemy = newEnemy(); return false; }
      return b.x > -6 && b.x < W() + 6 && b.y > -6 && b.y < H() + 6;
    });
    if (elapsed >= LIMIT) over = true;
  }
  return {
    frame(t, dt) {
      if (dt > 0) update(dt);
      const c = api.ctx;
      c.fillStyle = over ? "#400000" : "#000000"; c.fillRect(0, 0, W(), H());
      if (!over) {
        c.fillStyle = "#00ff00"; c.fillRect(W() / 2 - 15, H() - 10 - 16, 30, 16);
        c.fillStyle = "#ff0000"; c.fillRect(enemy.x, enemy.y, 24, 24);
        c.fillStyle = "#ffffff"; for (const b of bullets) c.fillRect(b.x - 3, b.y - 3, 6, 6);
        c.fillStyle = "#00ffff"; c.fillRect(W() / 2 - 50, H() - 4, 100 * (1 - cool / COOL), 4);
      }
      c.fillStyle = "#ffff00"; for (let i = 0; i < score; i++) c.fillRect(8 + i * 12, 4, 8, 8);
    },
    input(ev) {
      if (ev.type === "pointermove" || ev.type === "pointerdown") aim = { x: ev.x, y: ev.y };
      if (ev.type !== "keydown") return;
      if (ev.code === "KeyR" || ev.key === "r" || ev.key === "R") { reset(); return; }
      if ((ev.code === "Space" || ev.key === " ") && !over && cool <= 0) {
        const ox = W() / 2, oy = H() - 26;
        let dx = 0, dy = -1;
        if (aim) { const L = Math.hypot(aim.x - ox, aim.y - oy) || 1; dx = (aim.x - ox) / L; dy = (aim.y - oy) / L; }
        bullets.push({ x: ox, y: oy, vx: dx * SPEED, vy: dy * SPEED });
        cool = COOL;
      }
    },
  };
});
