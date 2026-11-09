// 合成データの棒グラフ。凡例のクリックで系列を絞り込む（調整用・P1 固定応答）
canvasApp.start((api) => {
  const d = api.data || { categories: [], months: [], values: {} };
  const hidden = new Set();
  let chips = [];
  return {
    frame() {
      const c = api.ctx, W = api.width, H = api.height;
      c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#222222"; c.font = "14px sans-serif"; c.textBaseline = "top";
      c.fillText(d.title || "", 12, 8);
      // 凡例
      chips = [];
      let x = 12;
      for (const cat of d.categories) {
        const w = 18 + c.measureText(cat.name).width + 16;
        chips.push({ name: cat.name, x, y: 30, w, h: 20 });
        c.fillStyle = hidden.has(cat.name) ? "#dddddd" : cat.color; c.fillRect(x, 33, 14, 14);
        c.fillStyle = hidden.has(cat.name) ? "#999999" : "#222222"; c.fillText(cat.name, x + 18, 32);
        x += w;
      }
      const shown = d.categories.filter((k) => !hidden.has(k.name));
      const top = 64, bottom = H - 28, left = 40, right = W - 12;
      let max = 1;
      for (const k of shown) for (const v of d.values[k.name]) max = Math.max(max, v);
      c.strokeStyle = "#333333"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(left, top); c.lineTo(left, bottom); c.lineTo(right, bottom); c.stroke();
      const gw = (right - left) / Math.max(1, d.months.length);
      d.months.forEach((m, i) => {
        c.fillStyle = "#222222"; c.fillText(m, left + i * gw + gw / 2 - 10, bottom + 6);
        const bw = (gw - 10) / Math.max(1, shown.length);
        shown.forEach((k, j) => {
          const v = d.values[k.name][i], h = ((bottom - top) * v) / max;
          c.fillStyle = k.color; c.fillRect(left + i * gw + 5 + j * bw, bottom - h, Math.max(1, bw - 2), h);
        });
      });
    },
    input(ev) {
      if (ev.type !== "pointerdown") return;
      const hit = chips.find((k) => ev.x >= k.x && ev.x <= k.x + k.w && ev.y >= k.y && ev.y <= k.y + k.h);
      if (hit) { if (hidden.has(hit.name)) hidden.delete(hit.name); else hidden.add(hit.name); }
    },
  };
});
