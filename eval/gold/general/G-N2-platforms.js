canvasApp.start((api) => {
  const W = () => api.width, H = () => api.height;
  const PW = 16, PH = 24, SPEED = 160, JUMP = 520, G = 1400;
  const plats = () => [
    { x: 110, w: 100, top: H() - 100 },
    { x: 250, w: 100, top: H() - 170 },
    { x: 360, w: 90, top: H() - 240 },
  ];
  let p = { x: 30, y: 0, vy: 0, ground: true }, keys = {}, score = 0, starOn = 2;
  p.y = H() - 30 - PH;
  function update(s) {
    const ps = plats();
    if (keys.l) p.x -= SPEED * s;
    if (keys.r) p.x += SPEED * s;
    p.x = Math.max(0, Math.min(W() - PW, p.x));
    const prevBottom = p.y + PH;
    p.vy += G * s; p.y += p.vy * s;
    p.ground = false;
    const floor = H() - 30;
    if (p.y + PH >= floor) { p.y = floor - PH; p.vy = 0; p.ground = true; }
    for (const q of ps)
      if (p.vy >= 0 && prevBottom <= q.top + 0.01 && p.y + PH >= q.top && p.x + PW > q.x && p.x < q.x + q.w) { p.y = q.top - PH; p.vy = 0; p.ground = true; }
    const st = star();
    if (p.x < st.x + 12 && p.x + PW > st.x && p.y < st.y + 12 && p.y + PH > st.y) { score++; starOn = starOn === 2 ? 0 : 2; }
  }
  function star() { const q = plats()[starOn]; return { x: q.x + q.w / 2 - 6, y: q.top - 30 - 12 }; }
  return {
    frame(t, dt) {
      if (dt > 0) update(dt / 1000);
      const c = api.ctx;
      c.fillStyle = "#000000"; c.fillRect(0, 0, W(), H());
      c.fillStyle = "#808080"; c.fillRect(0, H() - 30, W(), 30);
      c.fillStyle = "#00ffff"; for (const q of plats()) c.fillRect(q.x, q.top, q.w, 10);
      const st = star(); c.fillStyle = "#ffff00"; c.fillRect(st.x, st.y, 12, 12);
      for (let i = 0; i < score; i++) c.fillRect(8 + i * 12, 4, 8, 8);
      c.fillStyle = "#00ff00"; c.fillRect(p.x, p.y, PW, PH);
    },
    input(ev) {
      const d = ev.type === "keydown";
      if (ev.type !== "keydown" && ev.type !== "keyup") return;
      if (ev.code === "ArrowLeft" || ev.key === "ArrowLeft") keys.l = d;
      if (ev.code === "ArrowRight" || ev.key === "ArrowRight") keys.r = d;
      if (d && (ev.code === "Space" || ev.key === " ") && p.ground) { p.vy = -JUMP; p.ground = false; }
    },
  };
});
