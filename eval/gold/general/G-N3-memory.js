canvasApp.start((api) => {
  const COLORS = ["#ff0000", "#00ff00", "#0080ff", "#ff8000", "#c000ff", "#00ffff"];
  let cards, open, wait, pairs;
  function deal() {
    const deck = [...COLORS, ...COLORS];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(api.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    cards = deck.map((color, i) => ({ color, x: 60 + (i % 4) * 90, y: 40 + Math.floor(i / 4) * 100, up: false, done: false }));
    open = []; wait = 0; pairs = 0;
  }
  deal();
  return {
    frame(t, dt) {
      if (dt > 0 && wait > 0) { wait -= dt; if (wait <= 0) { for (const k of open) k.up = false; open = []; wait = 0; } }
      const c = api.ctx;
      c.fillStyle = pairs === 6 ? "#003000" : "#000000"; c.fillRect(0, 0, api.width, api.height);
      for (const k of cards) { c.fillStyle = k.up || k.done ? k.color : "#808080"; c.fillRect(k.x, k.y, 60, 80); }
      c.fillStyle = "#ffff00"; for (let i = 0; i < pairs; i++) c.fillRect(8 + i * 12, 4, 8, 8);
    },
    input(ev) {
      if (ev.type !== "pointerdown") return;
      if (pairs === 6) { deal(); return; }
      if (wait > 0) return;
      const k = cards.find((k) => ev.x >= k.x && ev.x < k.x + 60 && ev.y >= k.y && ev.y < k.y + 80);
      if (!k || k.up || k.done) return;
      k.up = true; open.push(k);
      if (open.length === 2) {
        if (open[0].color === open[1].color) { for (const o of open) o.done = true; open = []; pairs++; }
        else wait = 800;
      }
    },
  };
});
