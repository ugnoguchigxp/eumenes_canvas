// お絵かき：上のパレットで色を選び、ドラッグで線を描く。
canvasApp.start((api) => {
  const SWATCHES = [
    { x: 8, color: "#000000" },
    { x: 40, color: "#ff0000" },
    { x: 72, color: "#0000ff" },
  ];
  const TOOLBAR_H = 40;
  const WIDTHS = [{ x: 120, w: 4 }, { x: 152, w: 12 }];
  const ERASER_X = 184;
  let width = 4, eraser = false;
  let color = "#000000";
  const strokes = [];
  let current = null;

  const inRect = (ev, x, y, w, h) => ev.x >= x && ev.x < x + w && ev.y >= y && ev.y < y + h;

  function drawStroke(c, s) {
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    c.lineWidth = s.width;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (s.points.length === 1) {
      c.beginPath();
      c.arc(s.points[0].x, s.points[0].y, s.width / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(s.points[0].x, s.points[0].y);
    for (const p of s.points.slice(1)) c.lineTo(p.x, p.y);
    c.stroke();
  }

  return {
    frame() {
      const c = api.ctx;
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, api.width, api.height);
      for (const s of strokes) drawStroke(c, s);
      if (current) drawStroke(c, current);
      c.fillStyle = "#f0f0f0";
      c.fillRect(0, 0, api.width, TOOLBAR_H);
      for (const s of SWATCHES) {
        if (s.color === color && !eraser) { c.fillStyle = "#808080"; c.fillRect(s.x - 2, 6, 28, 28); }
        c.fillStyle = s.color;
        c.fillRect(s.x, 8, 24, 24);
      }
      for (const b of WIDTHS) {
        if (b.w === width) { c.fillStyle = "#808080"; c.fillRect(b.x - 2, 6, 28, 28); }
        c.fillStyle = "#c0c0c0"; c.fillRect(b.x, 8, 24, 24);
        c.fillStyle = "#000000"; c.beginPath(); c.arc(b.x + 12, 20, b.w / 2, 0, Math.PI * 2); c.fill();
      }
      if (eraser) { c.fillStyle = "#808080"; c.fillRect(ERASER_X - 2, 6, 28, 28); }
      c.fillStyle = "#ffc0c0"; c.fillRect(ERASER_X, 8, 24, 24);
    },
    input(ev) {
      if (ev.type === "pointerdown") {
        if (ev.y < TOOLBAR_H) {
          for (const s of SWATCHES) if (inRect(ev, s.x, 8, 24, 24)) { color = s.color; eraser = false; }
          for (const b of WIDTHS) if (inRect(ev, b.x, 8, 24, 24)) width = b.w;
          if (inRect(ev, ERASER_X, 8, 24, 24)) eraser = true;
          return;
        }
        current = { color: eraser ? "#ffffff" : color, width, points: [{ x: ev.x, y: ev.y }] };
      } else if (ev.type === "pointermove" && current) {
        current.points.push({ x: ev.x, y: Math.max(TOOLBAR_H, ev.y) });
      } else if (ev.type === "pointerup" && current) {
        strokes.push(current);
        current = null;
      }
    },
  };
});
