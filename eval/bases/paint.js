// お絵かき：上のパレットで色を選び、ドラッグで線を描く。
canvasApp.start((api) => {
  const SWATCHES = [
    { x: 8, color: "#000000" },
    { x: 40, color: "#ff0000" },
    { x: 72, color: "#0000ff" },
  ];
  const TOOLBAR_H = 40;
  const WIDTH = 4;
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
        if (s.color === color) { c.fillStyle = "#808080"; c.fillRect(s.x - 2, 6, 28, 28); }
        c.fillStyle = s.color;
        c.fillRect(s.x, 8, 24, 24);
      }
    },
    input(ev) {
      if (ev.type === "pointerdown") {
        if (ev.y < TOOLBAR_H) {
          for (const s of SWATCHES) if (inRect(ev, s.x, 8, 24, 24)) color = s.color;
          return;
        }
        current = { color, width: WIDTH, points: [{ x: ev.x, y: ev.y }] };
      } else if (ev.type === "pointermove" && current) {
        current.points.push({ x: ev.x, y: Math.max(TOOLBAR_H, ev.y) });
      } else if (ev.type === "pointerup" && current) {
        strokes.push(current);
        current = null;
      }
    },
  };
});
