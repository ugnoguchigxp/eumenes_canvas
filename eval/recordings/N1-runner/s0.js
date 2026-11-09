// ジャンプで障害物を越える横スクロール
canvasApp.start((api) => {
  const PX = 60, P = 20, OW = 20, OH = 30, SPEED = 0.2;
  const JUMP_H = 80, AIR = 700;
  const G = (8 * JUMP_H) / (AIR * AIR), V0 = (4 * JUMP_H) / AIR;
  let y, vy, obs, nextSpawn, score, over;
  function reset() { y = 0; vy = 0; obs = []; nextSpawn = 1000; score = 0; over = false; }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, GY = H - 40;
      if (!over) {
        if (y > 0 || vy > 0) { vy -= G * dt; y += vy * dt; if (y <= 0) { y = 0; vy = 0; } }
        nextSpawn -= dt;
        if (nextSpawn <= 0) { obs.push({ x: W, passed: false }); nextSpawn = 1500 + api.random() * 1000; }
        for (const o of obs) {
          o.x -= SPEED * dt;
          if (!o.passed && o.x + OW < PX) { o.passed = true; score++; }
        }
        obs = obs.filter((o) => o.x + OW > -10);
        const top = GY - P - y;
        for (const o of obs) if (o.x < PX + P && o.x + OW > PX && top + P > GY - OH) over = true;
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#808080"; c.fillRect(0, GY, W, 4);
      c.fillStyle = "#ff0000"; for (const o of obs) c.fillRect(o.x, GY - OH, OW, OH);
      c.fillStyle = "#00ff00"; c.fillRect(PX, GY - P - y, P, P);
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(score, 40); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("GAME OVER  R でやり直し", 20, H / 2); }
    },
    input(ev) {
      if (ev.type !== "keydown") return;
      if (ev.code === "KeyR") { reset(); return; }
      if (ev.code === "Space" && !over && y === 0 && vy === 0) vy = V0;
    },
  };
});
