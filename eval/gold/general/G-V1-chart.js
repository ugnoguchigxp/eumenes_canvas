// 月別の推移：登録データ（2 系列×24 か月）を折れ線で描く。起動時に 0.8 秒かけて左から描く。
canvasApp.start((api) => {
  const data = api.data;
  const PLOT = { left: 40, right: 440, top: 20, bottom: 320 }; // 描画領域（縦軸 0〜100）
  const INTRO_MS = 800;
  const months = data ? data.months : [];
  const series = data ? data.series : [];
  let view = { from: 0, to: months.length - 1 };
  let hover = null, dragFrom = null;
  const inPlot = (x, y) => x >= PLOT.left && x <= PLOT.right && y >= PLOT.top && y <= PLOT.bottom;
  const nearest = (x) => Math.max(view.from, Math.min(view.to, Math.round(view.from + ((x - PLOT.left) * (view.to - view.from)) / (PLOT.right - PLOT.left))));

  const xOf = (i) => PLOT.left + ((i - view.from) * (PLOT.right - PLOT.left)) / Math.max(1, view.to - view.from);
  const yOf = (v) => PLOT.bottom - (v / 100) * (PLOT.bottom - PLOT.top);

  return {
    frame(t) {
      const c = api.ctx, W = api.width, H = api.height;
      c.fillStyle = "#000000";
      c.fillRect(0, 0, W, H);
      c.strokeStyle = "#404040";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(PLOT.left - 0.5, PLOT.top);
      c.lineTo(PLOT.left - 0.5, PLOT.bottom + 0.5);
      c.lineTo(PLOT.right, PLOT.bottom + 0.5);
      c.stroke();
      const shown = Math.min(1, t / INTRO_MS);
      const last = view.from + Math.floor(shown * (view.to - view.from));
      for (const s of series) {
        c.strokeStyle = s.line;
        c.lineWidth = 2;
        c.beginPath();
        for (let i = view.from; i <= last; i++) (i === view.from ? c.moveTo : c.lineTo).call(c, xOf(i), yOf(s.values[i]));
        c.stroke();
        c.fillStyle = s.color;
        for (let i = view.from; i <= last; i++) c.fillRect(Math.round(xOf(i)) - 3, Math.round(yOf(s.values[i])) - 3, 6, 6);
      }
      c.fillStyle = "#c0c0c0";
      c.font = "11px sans-serif";
      c.fillText(months[view.from] ?? "", PLOT.left, PLOT.bottom + 16);
      c.fillText(months[view.to] ?? "", PLOT.right - 40, PLOT.bottom + 16);
      if (hover && inPlot(hover.x, hover.y)) {
        const i = nearest(hover.x), gx = Math.round(xOf(i));
        c.fillStyle = "#808080";
        c.fillRect(gx, PLOT.top, 1, PLOT.bottom - PLOT.top);
        const tw = 110, th = 40, tx = hover.x + 8, ty = hover.y - 8 - th;
        c.fillStyle = "#ffffff";
        c.fillRect(tx, ty, tw, th);
        c.fillStyle = "#000000";
        c.font = "11px sans-serif";
        c.fillText(months[i], tx + 4, ty + 12);
        series.forEach((s, k) => c.fillText(`${s.name}: ${s.values[i]}`, tx + 4, ty + 24 + k * 12));
      }
    },
    input(ev) {
      if (ev.type === "pointermove" || ev.type === "pointerdown" || ev.type === "pointerup") hover = { x: ev.x, y: ev.y };
      if (ev.type === "pointerdown" && inPlot(ev.x, ev.y)) dragFrom = ev.x;
      if (ev.type === "pointerup" && dragFrom !== null) {
        const a = Math.min(dragFrom, ev.x), b = Math.max(dragFrom, ev.x);
        dragFrom = null;
        const sel = [];
        for (let i = view.from; i <= view.to; i++) if (xOf(i) >= a && xOf(i) <= b) sel.push(i);
        if (sel.length >= 2) view = { from: sel[0], to: sel[sel.length - 1] };
      }
      if (ev.type === "keydown" && (ev.code === "KeyR" || ev.key === "r" || ev.key === "R")) view = { from: 0, to: months.length - 1 };
    },
  };
});
