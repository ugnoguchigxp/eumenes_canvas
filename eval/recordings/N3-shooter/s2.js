canvasApp.start((api) => {
  const P = { w: 30, h: 12, v: 0.25 }, B = { w: 4, h: 10, v: 0.4 }, E = { w: 24, h: 16, v: 0.1 };
  const MAX_SHOTS = 10;
  const pressed = {};
  let ship, bul, foe, hits, used, gameOver;
  const newFoe = (avoidX) => {
    let x;
    do x = api.random() * (api.width - E.w); while (avoidX !== undefined && Math.abs(x - avoidX) < 40 && api.width > 120);
    foe = { x, y: 50 + Math.floor(api.random() * 21) - 0, v: E.v * (api.random() < 0.5 ? 1 : -1) };
    if (foe.y + 0 > 70) foe.y = 70;
  };
  const reset = () => { ship = (api.width - P.w) / 2; bul = null; hits = 0; used = 0; gameOver = false; newFoe(); };
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, top = H - 30 - P.h;
      if (!gameOver) {
        ship += ((pressed.ArrowRight ? 1 : 0) - (pressed.ArrowLeft ? 1 : 0)) * P.v * dt;
        ship = Math.max(0, Math.min(W - P.w, ship));
        foe.x += foe.v * dt;
        if (foe.x <= 0 || foe.x >= W - E.w) { foe.v = -foe.v; foe.x = Math.max(0, Math.min(W - E.w, foe.x)); }
        if (bul) {
          bul.y -= B.v * dt;
          const overlap = bul.x < foe.x + E.w && bul.x + B.w > foe.x && bul.y < foe.y + E.h && bul.y + B.h > foe.y;
          if (overlap) { hits++; const old = foe.x; bul = null; newFoe(old); }
          else if (bul.y < -B.h) bul = null;
        }
        if (used >= MAX_SHOTS && !bul) gameOver = true;
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ff0000"; c.fillRect(Math.round(foe.x), Math.round(foe.y), E.w, E.h);
      if (bul) { c.fillStyle = "#ffffff"; c.fillRect(Math.round(bul.x), Math.round(bul.y), B.w, B.h); }
      c.fillStyle = "#00ff00"; c.fillRect(Math.round(ship), top, P.w, P.h);
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(40, hits); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (gameOver) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("GAME OVER  R", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keyup") pressed[ev.code] = false;
      if (ev.type !== "keydown") return;
      pressed[ev.code] = true;
      if (ev.code === "KeyR") reset();
      if (ev.code === "Space" && !gameOver && !bul && used < MAX_SHOTS) { used++; bul = { x: ship + P.w / 2 - B.w / 2, y: api.height - 30 - P.h - B.h }; }
    },
  };
});
