// 未使用課題の元作品：散布図と凡例による絞り込み（評価担当が凍結）
canvasApp.start((api) => {
  const d = api.data || { groups: [], points: [] };
  const hidden = new Set();
  let chips = [];
  return {
    frame() {
      const c = api.ctx, W = api.width, H = api.height;
      c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#222222"; c.font = "13px sans-serif"; c.textBaseline = "top";
      c.fillText(d.title || "", 10, 6);
      chips = [];
      let x = 10;
      for (const g of d.groups) {
        const w = 20 + c.measureText(g.name).width + 14;
        chips.push({ name: g.name, x, y: 26, w, h: 20 });
        c.fillStyle = hidden.has(g.name) ? "#dddddd" : g.color; c.fillRect(x, 29, 14, 14);
        c.fillStyle = "#222222"; c.fillText(g.name, x + 18, 29);
        x += w;
      }
      const L = 40, R = W - 10, T = 56, B = H - 24;
      c.strokeStyle = "#333333"; c.beginPath(); c.moveTo(L, T); c.lineTo(L, B); c.lineTo(R, B); c.stroke();
      const color = Object.fromEntries(d.groups.map((g) => [g.name, g.color]));
      for (const p of d.points) {
        if (hidden.has(p.group)) continue;
        c.fillStyle = color[p.group];
        c.beginPath(); c.arc(L + (p.x / 100) * (R - L), B - (p.y / 100) * (B - T), 4, 0, Math.PI * 2); c.fill();
      }
    },
    input(ev) {
      if (ev.type !== "pointerdown") return;
      const hit = chips.find((k) => ev.x >= k.x && ev.x <= k.x + k.w && ev.y >= k.y && ev.y <= k.y + k.h);
      if (hit) hidden.has(hit.name) ? hidden.delete(hit.name) : hidden.add(hit.name);
    },
  };
});
