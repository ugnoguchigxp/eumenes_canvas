// よけゲーム（狭い画面でのポインターのずれを修正）
canvasApp.start((api) => {
  const SIZE = 20, ENEMY = 16, ENEMY_SPEED = 0.15, SPAWN_MS = 600;
  let px, enemies, spawnAcc, alive, over, keys = {};
  function reset() { px = api.width / 2; enemies = []; spawnAcc = 0; alive = 0; over = false; }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, PY = H - 40;
      if (!over) {
        alive += dt;
        if (keys.ArrowLeft) px -= 0.3 * dt;
        if (keys.ArrowRight) px += 0.3 * dt;
        px = Math.max(SIZE / 2, Math.min(W - SIZE / 2, px));
        spawnAcc += dt;
        while (spawnAcc >= SPAWN_MS) { spawnAcc -= SPAWN_MS; enemies.push({ x: ENEMY / 2 + api.random() * (W - ENEMY), y: -ENEMY }); }
        for (const e of enemies) e.y += ENEMY_SPEED * dt;
        enemies = enemies.filter((e) => e.y < H + ENEMY);
        for (const e of enemies) if (Math.abs(e.x - px) < (SIZE + ENEMY) / 2 && Math.abs(e.y - (PY + SIZE / 2)) < (SIZE + ENEMY) / 2) over = true;
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ff0000"; for (const e of enemies) c.fillRect(e.x - ENEMY / 2, e.y - ENEMY / 2, ENEMY, ENEMY);
      c.fillStyle = "#00ff00"; c.fillRect(px - SIZE / 2, PY, SIZE, SIZE);
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(40, Math.floor(alive / 1000)); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("GAME OVER  クリックで再開", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "pointermove" || ev.type === "pointerdown") px = ev.x;
      if (ev.type === "pointerdown" && over) reset();
      if (ev.type === "keydown") { keys[ev.code] = true; if (over && ev.code === "Space") reset(); }
      if (ev.type === "keyup") keys[ev.code] = false;
    },
  };
});
