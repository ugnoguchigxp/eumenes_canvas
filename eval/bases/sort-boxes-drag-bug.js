// 色分けパズル：下の箱をドラッグして、同じ色の枠に入れる。3 つそろえばクリア。R でやり直し。
canvasApp.start((api) => {
  const BOX = 56, SLOT = 64, BORDER = 3;
  const SLOTS = [
    { cx: 112, cy: 72, color: "#ff0000" },
    { cx: 240, cy: 72, color: "#00ff00" },
    { cx: 368, cy: 72, color: "#0080ff" },
  ];
  const HOMES = [
    { cx: 112, cy: 288, color: "#0080ff" },
    { cx: 240, cy: 288, color: "#ff0000" },
    { cx: 368, cy: 288, color: "#00ff00" },
  ];
  let boxes, drag, moves;

  function reset() {
    boxes = HOMES.map((h) => ({ cx: h.cx, cy: h.cy, home: h, color: h.color, slot: null }));
    drag = null;
    moves = 0;
  }
  reset();

  const inside = (b, x, y) => Math.abs(x - b.cx) <= BOX / 2 && Math.abs(y - b.cy) <= BOX / 2;
  const cleared = () => boxes.every((b) => b.slot && b.slot.color === b.color);

  function drop(b) {
    const s = SLOTS.find((s) => Math.abs(b.cx - s.cx) <= SLOT / 2 && Math.abs(b.cy - s.cy) <= SLOT / 2 && !boxes.some((o) => o !== b && o.slot === s));
    if (s) { b.cx = s.cx; b.cy = s.cy; b.slot = s; }
    else { b.cx = b.home.cx; b.cy = b.home.cy; b.slot = null; }
  }

  return {
    frame() {
      const c = api.ctx, W = api.width, H = api.height;
      c.fillStyle = cleared() ? "#003000" : "#000000";
      c.fillRect(0, 0, W, H);
      for (const s of SLOTS) {
        c.strokeStyle = s.color;
        c.lineWidth = BORDER;
        c.strokeRect(s.cx - SLOT / 2, s.cy - SLOT / 2, SLOT, SLOT);
      }
      for (const b of boxes) if (b !== drag?.box) { c.fillStyle = b.color; c.fillRect(b.cx - BOX / 2, b.cy - BOX / 2, BOX, BOX); }
      if (drag) { c.fillStyle = drag.box.color; c.fillRect(drag.box.cx - BOX / 2, drag.box.cy - BOX / 2, BOX, BOX); }
      c.fillStyle = "#ffffff";
      for (let i = 0; i < Math.min(moves, 20); i++) c.fillRect(W - 14 - i * 10, 6, 6, 6);
    },
    input(ev) {
      if (ev.type === "pointerdown") {
        const b = [...boxes].reverse().find((b) => inside(b, ev.x, ev.y));
        if (b) { drag = { box: b, dx: ev.x - b.cx, dy: ev.y - b.cy }; b.slot = null; moves++; }
      } else if (ev.type === "pointermove" && drag) {
        if (inside(drag.box, ev.x, ev.y)) {
          drag.box.cx = ev.x - drag.dx;
          drag.box.cy = ev.y - drag.dy;
        } else {
          drag = null;
        }
      } else if (ev.type === "pointerup" && drag) {
        drop(drag.box);
        drag = null;
      } else if (ev.type === "keydown" && (ev.code === "KeyR" || ev.key === "r" || ev.key === "R")) reset();
    },
  };
});
