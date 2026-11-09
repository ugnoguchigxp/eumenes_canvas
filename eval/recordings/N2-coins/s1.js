canvasApp.start((api) => {
  const held = new Set();
  const game = {};
  const newCoin = () => {
    const W = api.width, H = api.height;
    game.coin = { x: 10 + api.random() * (W - 20), y: 40 + api.random() * (H - 60) };
  };
  const start = () => {
    game.p = { x: api.width / 2 - 10, y: api.height / 2 - 10 };
    game.score = 0; game.remain = 20000; game.ended = false;
    newCoin();
  };
  start();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, g = game;
      if (!g.ended) {
        const step = 0.2 * dt;
        if (held.has("ArrowLeft")) g.p.x -= step;
        if (held.has("ArrowRight")) g.p.x += step;
        if (held.has("ArrowUp")) g.p.y -= step;
        if (held.has("ArrowDown")) g.p.y += step;
        g.p.x = Math.min(Math.max(g.p.x, 0), W - 20);
        g.p.y = Math.min(Math.max(g.p.y, 0), H - 20);
        // 四角と円の重なり
        const cx = Math.min(Math.max(g.coin.x, g.p.x), g.p.x + 20), cy = Math.min(Math.max(g.coin.y, g.p.y), g.p.y + 20);
        if (Math.hypot(cx - g.coin.x, cy - g.coin.y) < 8) { g.score++; newCoin(); }
        g.remain = Math.max(0, g.remain - dt);
        if (g.remain === 0) g.ended = true;
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#00ffff"; c.beginPath(); c.arc(g.coin.x, g.coin.y, 8, 0, 2 * Math.PI); c.fill();
      c.fillStyle = "#00ff00"; c.fillRect(g.p.x, g.p.y, 20, 20);
      c.fillStyle = "#ffff00"; for (let i = 0; i < g.score && i < 40; i++) c.fillRect(4 + i * 10, 4, 8, 8);
      c.fillStyle = "#ffffff"; c.fillRect(0, H - 6, W * (g.remain / 20000), 6);
      if (g.ended) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("時間切れ  R", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keydown") { held.add(ev.code); if (ev.code === "KeyR") start(); }
      else if (ev.type === "keyup") held.delete(ev.code);
    },
  };
});
