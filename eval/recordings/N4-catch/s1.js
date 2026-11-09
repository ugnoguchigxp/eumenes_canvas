canvasApp.start((api) => {
  const g = { tray: 0, f: null, got: 0, lost: 0, done: false };
  const next = () => { g.f = { x: 10 + api.random() * (api.width - 20), y: -10 }; };
  const restart = () => { g.tray = api.width / 2; g.got = 0; g.lost = 0; g.done = false; next(); };
  restart();
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, top = H - 42; // 受け皿の上端（下端は H - 30）
      if (!g.done) {
        const prevY = g.f.y;
        g.f.y += 0.15 * dt;
        const crossed = prevY + 10 < top + 1 && g.f.y + 10 >= top;
        if ((crossed || (g.f.y + 10 >= top && g.f.y - 10 <= top + 12)) && Math.abs(g.f.x - g.tray) <= 40 + 4) { g.got++; next(); }
        else if (g.f.y > H + 10) { g.lost++; if (g.lost >= 3) g.done = true; else next(); }
      }
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W, H);
      c.fillStyle = "#ff8000"; c.beginPath(); c.arc(g.f.x, g.f.y, 10, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#00ff00"; c.fillRect(g.tray - 40, top, 80, 12);
      c.fillStyle = "#ffff00"; for (let i = 0; i < g.got && i < 40; i++) c.fillRect(4 + i * 10, 4, 8, 8);
      if (g.done) { c.fillStyle = "#400000"; c.fillRect(0, 0, W, H); c.fillStyle = "#ffffff"; c.font = "16px sans-serif"; c.fillText("3 ミス  クリックで再開", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "pointermove") g.tray = Math.min(api.width - 40, Math.max(40, ev.x));
      else if (ev.type === "pointerdown") { if (g.done) restart(); else g.tray = Math.min(api.width - 40, Math.max(40, ev.x)); }
    },
  };
});
