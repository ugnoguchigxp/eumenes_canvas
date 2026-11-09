// 月別の推移：登録データ（2 系列×24 か月）を折れ線で描く。起動時に 0.8 秒かけて左から描く。
canvasApp.start((api) => {
  const data = api.data;
  const PLOT = { left: 40, right: 440, top: 20, bottom: 320 }; // 描画領域（縦軸 0〜100）
  const INTRO_MS = 800;
  const months = data ? data.months : [];
  const series = data ? data.series : [];
  let view = { from: 0, to: months.length - 1 };

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
    },
  };
});
