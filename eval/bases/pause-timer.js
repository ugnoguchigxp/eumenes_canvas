// よけゲーム（一時停止つき）：←→ で自機を動かし、落ちてくる敵をよける。30 秒よけきればクリア。P で一時停止、R でやり直し。
canvasApp.start((api) => {
  const LIMIT = 30000; // ms
  const SPEED = 200, ENEMY_SPEED = 120, SPAWN_MS = 800;
  const PW = 20, PLAYER_BOTTOM = 30, ES = 16;
  let player, enemies, spawnAcc, paused, state, elapsed, keys;

  function reset() {
    player = { x: api.width / 2 };
    enemies = [];
    spawnAcc = SPAWN_MS; // 最初の敵は起動直後
    paused = false;
    state = "play";
    elapsed = 0;
    keys = {};
  }
  reset();

  function remaining() {
    return Math.max(0, LIMIT - elapsed);
  }

  function update(dt) {
    const W = api.width, H = api.height, s = dt / 1000;
    elapsed += dt;
    if (keys.left) player.x -= SPEED * s;
    if (keys.right) player.x += SPEED * s;
    player.x = Math.max(PW / 2, Math.min(W - PW / 2, player.x));
    spawnAcc += dt;
    while (spawnAcc >= SPAWN_MS) {
      spawnAcc -= SPAWN_MS;
      enemies.push({ x: 8 + api.random() * (W - 16 - ES), y: -ES });
    }
    for (const e of enemies) e.y += ENEMY_SPEED * s;
    enemies = enemies.filter((e) => e.y < H);
    const py = H - PLAYER_BOTTOM - PW;
    for (const e of enemies)
      if (e.x < player.x + PW / 2 && e.x + ES > player.x - PW / 2 && e.y < py + PW && e.y + ES > py) state = "over";
    if (state === "play" && remaining() <= 0) state = "clear";
  }

  return {
    frame(t, dt) {
      if (dt > 0 && state === "play" && !paused) update(dt);
      const c = api.ctx, W = api.width, H = api.height;
      c.fillStyle = state === "over" ? "#400000" : state === "clear" ? "#003000" : "#000000";
      c.fillRect(0, 0, W, H);
      if (state !== "play") {
        c.fillStyle = "#ffffff";
        c.font = "20px sans-serif";
        c.fillText(state === "over" ? "GAME OVER" : "CLEAR", W / 2 - 50, H / 2);
        return;
      }
      c.fillStyle = "#ff0000";
      for (const e of enemies) c.fillRect(e.x, e.y, ES, ES);
      c.fillStyle = "#00ff00";
      c.fillRect(player.x - PW / 2, H - PLAYER_BOTTOM - PW, PW, PW);
      c.fillStyle = "#ffffff";
      c.fillRect(0, H - 6, (W * remaining()) / LIMIT, 6);
      if (paused) {
        c.fillRect(W / 2 - 18, H / 2 - 20, 10, 40);
        c.fillRect(W / 2 + 8, H / 2 - 20, 10, 40);
      }
    },
    input(ev) {
      const down = ev.type === "keydown";
      if (ev.type !== "keydown" && ev.type !== "keyup") return;
      if (ev.code === "ArrowLeft" || ev.key === "ArrowLeft") keys.left = down;
      if (ev.code === "ArrowRight" || ev.key === "ArrowRight") keys.right = down;
      if (down && (ev.code === "KeyP" || ev.key === "p" || ev.key === "P") && state === "play") paused = !paused;
      if (down && (ev.code === "KeyR" || ev.key === "r" || ev.key === "R")) reset();
    },
  };
});
