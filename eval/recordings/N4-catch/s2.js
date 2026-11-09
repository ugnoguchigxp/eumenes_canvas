canvasApp.start((api) => {
  const BASKET = { w: 80, h: 12, gap: 30 }, FRUIT = { r: 10, v: 0.15 };
  let cx, item, caught, misses, over;
  function spawn() { item = { x: FRUIT.r + api.random() * (api.width - FRUIT.r * 2), y: -FRUIT.r, live: true }; }
  function reset() { cx = api.width / 2; caught = 0; misses = 0; over = false; spawn(); }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, by = H - BASKET.gap - BASKET.h;
      if (!over) {
        item.y += FRUIT.v * dt;
        const bottom = item.y + FRUIT.r;
        if (item.live && bottom >= by && bottom <= by + BASKET.h + FRUIT.r) {
          if (item.x > cx - BASKET.w / 2 - FRUIT.r * 0.5 && item.x < cx + BASKET.w / 2 + FRUIT.r * 0.5) { caught++; spawn(); }
        }
        if (item.y - FRUIT.r > H) { misses++; if (misses >= 3) over = true; else spawn(); }
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ff8000"; c.beginPath(); c.arc(item.x, item.y, FRUIT.r, 0, 2 * Math.PI); c.fill();
      c.fillStyle = "#00ff00"; c.fillRect(Math.round(cx - BASKET.w / 2), by, BASKET.w, BASKET.h);
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(40, caught); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("GAME OVER", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "pointerdown" && over) { reset(); return; }
      if (ev.type === "pointermove" || ev.type === "pointerdown") cx = Math.max(BASKET.w / 2, Math.min(api.width - BASKET.w / 2, ev.x));
    },
  };
});
