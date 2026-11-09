// 散布図（凡例を右側に縦に配置）
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
      const colX = W - 100;
      let y = 40;
      for (const g of d.groups) {
        chips.push({ name: g.name, x: colX - 2, y: y - 3, w: 96, h: 20 });
        c.fillStyle = hidden.has(g.name) ? "#dddddd" : g.color; c.fillRect(colX, y, 14, 14);
        c.fillStyle = "#222222"; c.fillText(g.name, colX + 18, y);
        y += 26;
      }
      const L = 40, R = W - 115, T = 32, B = H - 24;
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
