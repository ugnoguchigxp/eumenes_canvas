canvasApp.start((api) => {
  const keys = new Set();
  let s;
  function fresh() {
    s = { x: api.width / 2, shot: null, fired: 0, score: 0, end: false, foe: null };
    respawn();
  }
  function respawn() {
    s.foe = { x: 12 + api.random() * (api.width - 24), y: 58 + api.random() * 12 - 6, dir: api.random() < 0.5 ? 1 : -1 };
  }
  fresh();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, baseY = H - 30; // 自機の下端
      if (!s.end) {
        if (keys.has("ArrowLeft")) s.x -= 0.25 * dt;
        if (keys.has("ArrowRight")) s.x += 0.25 * dt;
        s.x = Math.min(W - 15, Math.max(15, s.x));
        const f = s.foe;
        f.x += f.dir * 0.1 * dt;
        if (f.x - 12 < 0) { f.x = 12; f.dir = 1; } else if (f.x + 12 > W) { f.x = W - 12; f.dir = -1; }
        if (s.shot) {
          s.shot.y -= 0.4 * dt;
          const hit = Math.abs(s.shot.x - f.x) < 12 + 2 && Math.abs(s.shot.y - f.y) < 8 + 5;
          if (hit) { s.score++; s.shot = null; respawn(); }
          else if (s.shot.y < -5) s.shot = null;
        }
        if (s.fired === 10 && !s.shot) s.end = true;
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ff0000"; c.fillRect(s.foe.x - 12, s.foe.y - 8, 24, 16);
      if (s.shot) { c.fillStyle = "#ffffff"; c.fillRect(s.shot.x - 2, s.shot.y - 5, 4, 10); }
      c.fillStyle = "#00ff00"; c.fillRect(s.x - 15, baseY - 12, 30, 12);
      c.fillStyle = "#ffff00"; for (let i = 0; i < s.score && i < 40; i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (s.end) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("弾切れ  R", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keyup") { keys.delete(ev.code); return; }
      if (ev.type !== "keydown") return;
      keys.add(ev.code);
      if (ev.code === "KeyR") fresh();
      if (ev.code === "Space" && !s.end && !s.shot && s.fired < 10) { s.fired++; s.shot = { x: s.x, y: api.height - 30 - 12 - 5 }; }
    },
  };
});
