canvasApp.start((api) => {
  const SIZE = 20, COIN_R = 8, V = 0.2, TOTAL = 20000;
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const down = {};
  let px, py, coin, pts, timeLeft, finished;
  function spawn() {
    coin = { x: COIN_R + api.random() * (api.width - COIN_R * 2), y: 30 + COIN_R + api.random() * (api.height - 30 - COIN_R * 2 - 8) };
  }
  function reset() { px = (api.width - SIZE) / 2; py = (api.height - SIZE) / 2; pts = 0; timeLeft = TOTAL; finished = false; spawn(); }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height;
      if (!finished) {
        let mx = 0, my = 0;
        for (const k in dir) if (down[k]) { mx += dir[k][0]; my += dir[k][1]; }
        px = Math.min(W - SIZE, Math.max(0, px + mx * V * dt));
        py = Math.min(H - SIZE, Math.max(0, py + my * V * dt));
        const qx = Math.max(px, Math.min(coin.x, px + SIZE)), qy = Math.max(py, Math.min(coin.y, py + SIZE));
        if (Math.hypot(qx - coin.x, qy - coin.y) <= COIN_R) { pts += 1; spawn(); }
        timeLeft -= dt;
        if (timeLeft <= 0) { timeLeft = 0; finished = true; }
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.beginPath(); c.fillStyle = "#00ffff"; c.arc(coin.x, coin.y, COIN_R, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#00ff00"; c.fillRect(Math.round(px), Math.round(py), SIZE, SIZE);
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(40, pts); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      c.fillStyle = "#ffffff"; c.fillRect(0, H - 6, Math.round((W * timeLeft) / TOTAL), 6);
      if (finished) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("終了  R でもう一度", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keydown") { down[ev.code] = true; if (ev.code === "KeyR") reset(); }
      if (ev.type === "keyup") down[ev.code] = false;
    },
  };
});
