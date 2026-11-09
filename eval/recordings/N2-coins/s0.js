// 矢印キーでコインを集める（制限時間 20 秒）
canvasApp.start((api) => {
  const S = 20, R = 8, SPEED = 0.2, LIMIT = 20000;
  let x, y, coin, score, left, over, keys = {};
  function placeCoin() {
    const W = api.width, H = api.height;
    coin = { x: R + api.random() * (W - 2 * R), y: 30 + R + api.random() * (H - 30 - 2 * R - 10) };
  }
  function reset() { x = api.width / 2 - S / 2; y = api.height / 2 - S / 2; score = 0; left = LIMIT; over = false; placeCoin(); }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height;
      if (!over) {
        const dx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
        const dy = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
        x = Math.max(0, Math.min(W - S, x + dx * SPEED * dt));
        y = Math.max(0, Math.min(H - S, y + dy * SPEED * dt));
        const nx = Math.max(x, Math.min(coin.x, x + S)), ny = Math.max(y, Math.min(coin.y, y + S));
        if ((nx - coin.x) ** 2 + (ny - coin.y) ** 2 <= R * R) { score++; placeCoin(); }
        left -= dt;
        if (left <= 0) { left = 0; over = true; }
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#00ffff"; c.beginPath(); c.arc(coin.x, coin.y, R, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#00ff00"; c.fillRect(x, y, S, S);
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(score, 40); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      c.fillStyle = "#ffffff"; c.fillRect(0, H - 6, (W * left) / LIMIT, 6);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("TIME UP  R でやり直し", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keydown") { keys[ev.code] = true; if (ev.code === "KeyR") reset(); }
      if (ev.type === "keyup") keys[ev.code] = false;
    },
  };
});
