// 落ちてくる果物を受け皿で受け止める
canvasApp.start((api) => {
  const BW = 80, BH = 12, FR = 10, FALL = 0.15, MAX_MISS = 3;
  let bx, fruit, score, miss, over;
  function drop() { fruit = { x: FR + api.random() * (api.width - 2 * FR), y: -FR }; }
  function reset() { bx = api.width / 2; score = 0; miss = 0; over = false; drop(); }
  reset();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, BY = H - 30 - BH;
      if (!over) {
        fruit.y += FALL * dt;
        const left = bx - BW / 2;
        if (fruit.y + FR >= BY && fruit.y - FR <= BY + BH && fruit.x >= left - FR / 2 && fruit.x <= left + BW + FR / 2) { score++; drop(); }
        else if (fruit.y - FR > H) { miss++; if (miss >= MAX_MISS) over = true; else drop(); }
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      if (!over) { c.fillStyle = "#ff8000"; c.beginPath(); c.arc(fruit.x, fruit.y, FR, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = "#00ff00"; c.fillRect(bx - BW / 2, BY, BW, BH);
      c.fillStyle = "#ffff00"; for (let i = 0; i < Math.min(score, 40); i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (over) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("GAME OVER  クリックでやり直し", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "pointermove" || ev.type === "pointerdown") bx = Math.max(BW / 2, Math.min(api.width - BW / 2, ev.x));
      if (ev.type === "pointerdown" && over) reset();
    },
  };
});
