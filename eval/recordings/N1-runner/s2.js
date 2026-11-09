canvasApp.start((api) => {
  const C = { left: 60, size: 20, obW: 20, obH: 30, speed: 200 / 1000, apex: 80, air: 700 };
  let jumpT, obstacles, spawnIn, points, dead;
  function init() { jumpT = -1; obstacles = []; spawnIn = 900; points = 0; dead = false; }
  init();
  // 経過時間から高さを決める（放物線）。jumpT < 0 は地上。
  const heightAt = (tt) => (tt < 0 ? 0 : 4 * C.apex * (tt / C.air) * (1 - tt / C.air));
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, gy = H - 40;
      if (!dead) {
        if (jumpT >= 0) { jumpT += dt; if (jumpT >= C.air) jumpT = -1; }
        spawnIn -= dt;
        if (spawnIn <= 0) { obstacles.push({ x: W + 0, scored: false }); spawnIn = 1500 + Math.floor(api.random() * 1001); }
        const ph = heightAt(jumpT);
        for (const o of obstacles) {
          o.x -= C.speed * dt;
          if (!o.scored && o.x + C.obW < C.left) { o.scored = true; points++; }
          if (o.x < C.left + C.size && o.x + C.obW > C.left && ph < C.obH) dead = true;
        }
        obstacles = obstacles.filter((o) => o.x > -C.obW);
      }
      const x = api.ctx;
      x.fillStyle = "#000000"; x.fillRect(0, 0, W, H);
      x.fillStyle = "#808080"; x.fillRect(0, gy, W, 4);
      x.fillStyle = "#ff0000"; for (const o of obstacles) x.fillRect(Math.round(o.x), gy - C.obH, C.obW, C.obH);
      x.fillStyle = "#00ff00"; x.fillRect(C.left, Math.round(gy - C.size - heightAt(jumpT)), C.size, C.size);
      x.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(40, points); i++) x.fillRect(4 + 10 * i, 4, 8, 8);
      if (dead) { x.fillStyle = "#400000"; x.fillRect(0, 0, W, H); x.fillStyle = "#ffffff"; x.font = "16px sans-serif"; x.fillText("GAME OVER  R", 20, H / 2); }
    },
    input(ev) {
      if (ev.type !== "keydown") return;
      if (ev.code === "KeyR") init();
      else if (ev.code === "Space" && !dead && jumpT < 0) jumpT = 0;
    },
  };
});
