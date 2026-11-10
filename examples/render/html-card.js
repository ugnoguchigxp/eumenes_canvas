// デモ：HTML in canvas。HTML/CSS で組んだカード（見出し・書式付きの文・表・進捗バー・ボタン・入力欄）を api.decodeSVG で画像にして
// Canvas 2D の上に描く。ボタンと入力欄は作品が自分の配置で当たり判定をし、キー入力で文字を受ける（HTML の要素は操作できないため）。
// 背景は 2D で動かす。ライブラリは使わない。
canvasApp.start((api) => {
  const W = 360, H = 250;                // カードの CSS ピクセル寸法
  const BTN = [{ id: "theme", x: 20, y: 196, w: 120, h: 36 }, { id: "plus", x: 152, y: 196, w: 90, h: 36 }];
  const FIELD = { x: 20, y: 150, w: 320, h: 34 };
  let dark = false, count = 0, text = "", focus = false, card = null, version = 0, pending = false, dirty = true;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function origin() { return { x: Math.round((api.width - W) / 2), y: Math.round((api.height - H) / 2) }; }
  function markup() {
    const bg = dark ? "#151a2e" : "#ffffff", fg = dark ? "#e8ecff" : "#1b2033", sub = dark ? "#9aa3c7" : "#5a6280", acc = dark ? "#ffb44a" : "#2457ff";
    const rows = [["温度", 21.5 + count * 0.5, "℃"], ["湿度", 48 - count, "%"], ["押した回数", count, "回"]];
    const pct = Math.min(100, count * 10);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W * api.dpr) + '" height="' + Math.round(H * api.dpr) + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<foreignObject width="' + W + '" height="' + H + '"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:' + W + 'px;height:' + H + 'px;padding:14px 20px;' +
      'border-radius:16px;background:' + bg + ';color:' + fg + ';font:14px sans-serif;box-shadow:0 0 0 2px ' + acc + ' inset">' +
      '<div style="font:700 20px sans-serif;color:' + acc + '">HTML <i>in</i> canvas</div>' +
      '<div style="color:' + sub + ';margin:2px 0 6px">CSS の<b>組版</b>・<u>書式</u>・表をそのまま画素にする</div>' +
      '<table style="border-collapse:collapse;width:100%;font-size:13px">' + rows.map((r, i) => '<tr style="background:' + (i % 2 ? "transparent" : (dark ? "#1f2640" : "#eef2ff")) + '"><td style="padding:2px 6px">' + r[0] + '</td><td style="padding:2px 6px;text-align:right;font-family:monospace">' + (typeof r[1] === "number" ? r[1].toFixed(r[0] === "温度" ? 1 : 0) : r[1]) + ' ' + r[2] + '</td></tr>').join("") + '</table>' +
      '<div style="height:6px;border-radius:3px;background:' + (dark ? "#2a3150" : "#dde3f5") + ';margin:6px 0"><div style="height:6px;border-radius:3px;width:' + pct + '%;background:' + acc + '"></div></div>' +
      '<div style="position:absolute;left:' + FIELD.x + 'px;top:' + FIELD.y + 'px;width:' + (FIELD.w - 16) + 'px;height:' + (FIELD.h - 2) + 'px;padding:0 8px;line-height:' + (FIELD.h - 2) + 'px;border-radius:8px;border:1px solid ' + (focus ? acc : sub) + ';color:' + (text ? fg : sub) + '">' + (text ? esc(text) : "ここをクリックして入力") + (focus ? '<span style="color:' + acc + '">|</span>' : "") + '</div>' +
      BTN.map((b) => '<div style="position:absolute;left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;border-radius:10px;background:' + acc + ';color:' + bg + ';font:700 14px sans-serif;text-align:center;line-height:' + b.h + 'px">' + (b.id === "theme" ? (dark ? "ライトにする" : "ダークにする") : "＋1") + '</div>').join("") +
      '</div></foreignObject></svg>';
  }
  function rebuild() {
    if (pending) { dirty = true; return; }
    dirty = false; pending = true;
    const v = ++version;
    api.decodeSVG(markup()).then((b) => { if (card) card.close(); card = b; pending = false; if (dirty) rebuild(); api.status({ version: v, dark, count, text }); },
      (e) => { pending = false; api.status({ error: String(e) }); });
  }
  rebuild();
  let hue = 0;
  return {
    resize() { rebuild(); },
    input(ev) {
      if (ev.type === "pointerdown") {
        const o = origin(), x = ev.x - o.x, y = ev.y - o.y;
        const hit = BTN.find((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
        const inField = x >= FIELD.x && x < FIELD.x + FIELD.w && y >= FIELD.y && y < FIELD.y + FIELD.h;
        if (hit && hit.id === "theme") dark = !dark;
        if (hit && hit.id === "plus") count++;
        if (inField !== focus) focus = inField;
        rebuild();
      } else if (ev.type === "keydown" && focus) {
        if (ev.key === "Backspace") text = text.slice(0, -1);
        else if (ev.key && ev.key.length === 1 && text.length < 30) text += ev.key;
        else return;
        rebuild();
      }
    },
    frame(t, dt) {
      if (dt > 0) hue = (hue + dt * 0.02) % 360;
      const c = api.ctx;
      const g = c.createLinearGradient(0, 0, api.width, api.height);
      g.addColorStop(0, `hsl(${hue}, 60%, 35%)`);
      g.addColorStop(1, `hsl(${(hue + 80) % 360}, 60%, 20%)`);
      c.fillStyle = g;
      c.fillRect(0, 0, api.width, api.height);
      const o = origin();
      if (card) c.drawImage(card, o.x, o.y, W, H);
      else { c.fillStyle = "#ffffff"; c.font = "14px sans-serif"; c.fillText("読み込み中…", o.x + 10, o.y + 20); }
    },
  };
});
