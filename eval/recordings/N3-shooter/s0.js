// 弾 10 発で敵を撃つシューティング
canvasApp.start((api) => {
  const PW = 30, PH = 12, BW = 4, BH = 10, EW = 24, EH = 16, AMMO = 10;
  let px, bullet, enemy, score, shots, over, keys = {};
  function placeEnemy() {
    const W = api.width;
    enemy = { x: api.random() * (W - EW), y: 50 + api.random() * (20 - 0), vx: api.random() < 0.5 ? -0.1 : 0.1 };
  }
  function reset() { px = api.width / 2 - PW / 2; bullet = null; score = 0; shots = 0; over = false; placeEnemy(); }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, PY = H - 30 - PH;
      if (!over) {
        const d = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
        px = Math.max(0, Math.min(W - PW, px + d * 0.25 * dt));
        enemy.x += enemy.vx * dt;
        if (enemy.x < 0) { enemy.x = 0; enemy.vx = Math.abs(enemy.vx); }
        if (enemy.x > W - EW) { enemy.x = W - EW; enemy.vx = -Math.abs(enemy.vx); }
        if (bullet) {
          bullet.y -= 0.4 * dt;
          if (bullet.x < enemy.x + EW && bullet.x + BW > enemy.x && bullet.y < enemy.y + EH && bullet.y + BH > enemy.y) { score++; bullet = null; placeEnemy(); }
          else if (bullet.y + BH < 0) bullet = null;
        }
        if (!bullet && shots >= AMMO) over = true;
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ff0000"; c.fillRect(enemy.x, enemy.y, EW, EH);
      if (bullet) { c.fillStyle = "#ffffff"; c.fillRect(bullet.x, bullet.y, BW, BH); }
      c.fillStyle = "#00ff00"; c.fillRect(px, PY, PW, PH);
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(score, 40); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("GAME OVER  R でやり直し", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keydown") {
        keys[ev.code] = true;
        if (ev.code === "KeyR") reset();
        else if (ev.code === "Space" && !over && !bullet && shots < AMMO) {
          shots++;
          bullet = { x: px + PW / 2 - BW / 2, y: api.height - 30 - PH - BH };
        }
      }
      if (ev.type === "keyup") keys[ev.code] = false;
    },
  };
});
