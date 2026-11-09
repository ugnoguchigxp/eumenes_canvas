// ソリティア（クロンダイク、1 枚めくり。デモ用の固定応答。Grok Bot が制作担当を代行して作成）
canvasApp.start((api) => {
  const SUITS = ["♠", "♥", "♦", "♣"], SUIT_CODE = "SHDC";
  const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const red = (c) => c.s === 1 || c.s === 2;
  const code = (c) => RANKS[c.r] + SUIT_CODE[c.s];
  let stock, waste, found, tab, moves, won, drag, message, history, seq, autoAcc;

  function deal() {
    const deck = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ s, r, up: false });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(api.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    tab = [];
    for (let i = 0; i < 7; i++) {
      const col = deck.splice(0, i + 1);
      col[col.length - 1].up = true;
      tab.push(col);
    }
    stock = deck; waste = []; found = [[], [], [], []];
    moves = 0; won = false; drag = null; history = []; autoAcc = 0; seq = seq || 0;
    message = "クリックで自動移動、ドラッグで好きな場所へ。山札をクリックでめくる";
    report();
  }
  function snapshot() {
    history.push(JSON.stringify({ stock, waste, found, tab, moves }));
    if (history.length > 200) history.shift();
  }
  function undo() {
    const h = history.pop();
    if (!h) { message = "戻せる手がありません"; return; }
    const o = JSON.parse(h);
    stock = o.stock; waste = o.waste; found = o.found; tab = o.tab; moves = o.moves; won = false;
    message = "1 手戻しました";
    report();
  }
  const top = (a) => a[a.length - 1];

  // ---- 規則 ----
  function canFound(card, fi) {
    const f = found[fi];
    if (!f.length) return card.r === 1;
    return top(f).s === card.s && card.r === top(f).r + 1;
  }
  function canTab(card, ti) {
    const t = tab[ti];
    if (!t.length) return card.r === 13;
    const tc = top(t);
    return tc.up && red(tc) !== red(card) && card.r === tc.r - 1;
  }
  function source(from) {
    if (from.pile === "waste") return waste;
    if (from.pile === "found") return found[from.i];
    return tab[from.i];
  }
  function cardsOf(from) {
    const a = source(from);
    return from.pile === "tab" ? a.slice(from.index) : a.length ? [top(a)] : [];
  }
  function validRun(cards) {
    for (let k = 1; k < cards.length; k++) {
      const a = cards[k - 1], b = cards[k];
      if (!b.up || red(a) === red(b) || b.r !== a.r - 1) return false;
    }
    return cards.length > 0 && cards[0].up;
  }
  /** 移動を試す。成功したら true。 */
  function tryMove(from, to) {
    const cards = cardsOf(from);
    if (!validRun(cards)) return false;
    if (to.pile === from.pile && to.i === from.i) return false;
    if (to.pile === "found") { if (cards.length !== 1 || !canFound(cards[0], to.i)) return false; }
    else if (to.pile === "tab") { if (!canTab(cards[0], to.i)) return false; }
    else return false;
    snapshot();
    const src = source(from);
    src.splice(src.length - cards.length, cards.length);
    const dst = to.pile === "found" ? found[to.i] : tab[to.i];
    dst.push(...cards);
    if (from.pile === "tab" && src.length && !top(src).up) top(src).up = true; // 表に返す
    moves++;
    message = "";
    checkWin();
    report();
    return true;
  }
  function autoMove(from) {
    const cards = cardsOf(from);
    if (!validRun(cards)) return false;
    if (cards.length === 1 && from.pile !== "found") for (let i = 0; i < 4; i++) if (tryMove(from, { pile: "found", i })) return true;
    // 空き列へのキングは、元が空き列の先頭でない場合だけ
    for (let i = 0; i < 7; i++) {
      if (from.pile === "tab" && from.i === i) continue;
      if (!tab[i].length && from.pile === "tab" && from.index === 0) continue;
      if (tryMove(from, { pile: "tab", i })) return true;
    }
    message = "その札を動かせる場所がありません";
    return false;
  }
  function draw() {
    snapshot();
    if (stock.length) { const c = stock.pop(); c.up = true; waste.push(c); message = ""; }
    else if (waste.length) { stock = waste.reverse().map((c) => ({ ...c, up: false })); waste = []; message = "山札を戻しました"; }
    else { history.pop(); return; }
    moves++;
    report();
  }
  function checkWin() {
    if (found.every((f) => f.length === 13)) { won = true; message = `クリア！ 手数 ${moves}`; }
  }
  const canAutoFinish = () => !won && !stock.length && !waste.length && tab.every((t) => t.every((c) => c.up));
  function autoStep() {
    for (let i = 0; i < 7; i++) if (tab[i].length) for (let f = 0; f < 4; f++) if (tryMove({ pile: "tab", i, index: tab[i].length - 1 }, { pile: "found", i: f })) return;
  }

  // ---- 配置 ----
  function layout() {
    const W = api.width, H = api.height;
    const g = Math.max(4, Math.floor(W * 0.012));
    const cw = Math.max(20, Math.floor(Math.min((W - g * 8) / 7, (H - g * 3 - 18) / 1.4 / 2.4)));
    const ch = Math.floor(cw * 1.4);
    const total = cw * 7 + g * 6;
    const left = Math.floor((W - total) / 2);
    const cols = Array.from({ length: 7 }, (_, i) => left + i * (cw + g));
    const topY = g, tabY = g * 2 + ch;
    const avail = H - 18 - tabY - ch - g;
    const offs = tab.map((t) => {
      const down = t.filter((c) => !c.up).length, up = t.length - down;
      const units = down + 2 * Math.max(0, up - 1);
      const d = Math.min(ch * 0.14, units ? avail / units : ch);
      return { d, u: Math.min(ch * 0.28, d * 2) };
    });
    return { g, cw, ch, cols, topY, tabY, offs };
  }
  function cardY(L, ti, k) {
    const t = tab[ti];
    let y = L.tabY;
    for (let j = 0; j < k; j++) y += t[j].up ? L.offs[ti].u : L.offs[ti].d;
    return y;
  }
  function inRect(x, y, rx, ry, w, h) { return x >= rx && x < rx + w && y >= ry && y < ry + h; }
  function hit(x, y) {
    const L = layout();
    if (inRect(x, y, L.cols[0], L.topY, L.cw, L.ch)) return { pile: "stock" };
    if (inRect(x, y, L.cols[1], L.topY, L.cw, L.ch)) return waste.length ? { pile: "waste" } : null;
    for (let i = 0; i < 4; i++) if (inRect(x, y, L.cols[3 + i], L.topY, L.cw, L.ch)) return found[i].length ? { pile: "found", i } : null;
    for (let i = 0; i < 7; i++) {
      const t = tab[i];
      for (let k = t.length - 1; k >= 0; k--) if (inRect(x, y, L.cols[i], cardY(L, i, k), L.cw, L.ch)) return t[k].up ? { pile: "tab", i, index: k } : { pile: "tab-down", i, index: k };
    }
    return null;
  }
  /** 落とした位置（札の中心）にある置き場。 */
  function dropTarget(cx, cy) {
    const L = layout();
    for (let i = 0; i < 7; i++) {
      if (cx < L.cols[i] - L.g / 2 || cx >= L.cols[i] + L.cw + L.g / 2) continue;
      if (cy < L.tabY - L.g / 2) return i >= 3 ? { pile: "found", i: i - 3 } : null;
      return { pile: "tab", i };
    }
    return null;
  }
  function report() {
    const L = layout();
    api.status({
      game: "solitaire", seq: ++seq, moves, won, stock: stock.length, waste: waste.length ? code(top(waste)) : null,
      found: found.map((f) => (f.length ? code(top(f)) : null)),
      tab: tab.map((t, i) => ({ down: t.filter((c) => !c.up).length, up: t.filter((c) => c.up).map(code), ys: t.map((c, k) => (c.up ? Math.round(cardY(L, i, k)) : null)).filter((v) => v !== null) })),
      layout: { cw: L.cw, ch: L.ch, cols: L.cols, topY: L.topY, tabY: L.tabY },
    });
  }

  // ---- 描画 ----
  function drawCard(c, card, x, y, L) {
    const r = Math.max(3, L.cw * 0.08);
    c.beginPath();
    c.roundRect ? c.roundRect(x, y, L.cw, L.ch, r) : c.rect(x, y, L.cw, L.ch);
    if (!card.up) {
      c.fillStyle = "#2453a6"; c.fill(); c.strokeStyle = "#dfe8ff"; c.lineWidth = 1; c.stroke();
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.strokeRect(x + 3, y + 3, L.cw - 6, L.ch - 6);
      return;
    }
    c.fillStyle = "#fdfdf8"; c.fill(); c.strokeStyle = "#555"; c.lineWidth = 1; c.stroke();
    c.fillStyle = red(card) ? "#c8102e" : "#111";
    const fs = Math.max(9, Math.floor(L.cw * 0.3));
    c.font = `bold ${fs}px sans-serif`; c.textBaseline = "top";
    c.fillText(RANKS[card.r], x + 3, y + 2);
    c.fillText(SUITS[card.s], x + 3, y + 2 + fs);
    c.font = `${Math.floor(L.cw * 0.5)}px sans-serif`; c.textBaseline = "middle";
    c.fillText(SUITS[card.s], x + L.cw * 0.42, y + L.ch * 0.62);
  }
  function slot(c, x, y, L, label) {
    c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 1.5;
    c.strokeRect(x + 0.5, y + 0.5, L.cw - 1, L.ch - 1);
    if (label) { c.fillStyle = "rgba(255,255,255,0.35)"; c.font = `${Math.floor(L.cw * 0.4)}px sans-serif`; c.textBaseline = "middle"; c.fillText(label, x + L.cw * 0.3, y + L.ch / 2); }
  }

  seq = 0;
  deal();

  return {
    frame(t, dt) {
      if (canAutoFinish()) {
        autoAcc += dt;
        while (autoAcc >= 90 && !won) { autoAcc -= 90; autoStep(); }
      }
      const c = api.ctx, L = layout();
      c.fillStyle = "#0b6b3a"; c.fillRect(0, 0, api.width, api.height);
      // 山札・捨て札・組札
      if (stock.length) drawCard(c, { up: false }, L.cols[0], L.topY, L); else slot(c, L.cols[0], L.topY, L, "↺");
      const hideTop = drag && drag.moved;
      const wasteShown = hideTop && drag.from.pile === "waste" ? waste.length - 1 : waste.length;
      if (wasteShown > 0) drawCard(c, waste[wasteShown - 1], L.cols[1], L.topY, L); else slot(c, L.cols[1], L.topY, L);
      for (let i = 0; i < 4; i++) {
        const f = found[i];
        const n = hideTop && drag.from.pile === "found" && drag.from.i === i ? f.length - 1 : f.length;
        if (n > 0) drawCard(c, f[n - 1], L.cols[3 + i], L.topY, L); else slot(c, L.cols[3 + i], L.topY, L, "A");
      }
      for (let i = 0; i < 7; i++) {
        const t = tab[i];
        if (!t.length) slot(c, L.cols[i], L.tabY, L, "K");
        const upto = hideTop && drag.from.pile === "tab" && drag.from.i === i ? drag.from.index : t.length;
        for (let k = 0; k < upto; k++) drawCard(c, t[k], L.cols[i], cardY(L, i, k), L);
      }
      if (drag && drag.moved) drag.cards.forEach((card, k) => drawCard(c, card, drag.x - drag.dx, drag.y - drag.dy + k * Math.floor(L.ch * 0.28), L));
      c.fillStyle = "#e8f5e8"; c.font = "12px sans-serif"; c.textBaseline = "bottom";
      c.fillText(`手数 ${moves}  ${message}`, 6, api.height - 3);
      c.textAlign = "right"; c.fillText("U 1 手戻す  R 新しいゲーム", api.width - 6, api.height - 3); c.textAlign = "left";
      if (won) {
        c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(0, api.height / 2 - 34, api.width, 68);
        c.fillStyle = "#ffd75e"; c.font = "bold 26px sans-serif"; c.textBaseline = "middle"; c.textAlign = "center";
        c.fillText(`クリア！ 手数 ${moves}（R で新しいゲーム）`, api.width / 2, api.height / 2);
        c.textAlign = "left";
      }
    },
    input(ev) {
      if (ev.type === "keydown") {
        if (ev.code === "KeyR") deal();
        else if (ev.code === "KeyU") undo();
        else if (ev.code === "Space" || ev.code === "KeyD") draw();
        return;
      }
      if (ev.type === "pointerdown") {
        if (ev.button !== undefined && ev.button !== 0) return;
        const h = hit(ev.x, ev.y);
        if (!h) return;
        if (h.pile === "stock") { draw(); return; }
        if (h.pile === "tab-down") return;
        const cards = cardsOf(h);
        if (!validRun(cards)) { message = "その並びは一度に動かせません"; return; }
        const L = layout();
        const rx = h.pile === "tab" ? L.cols[h.i] : h.pile === "waste" ? L.cols[1] : L.cols[3 + h.i];
        const ry = h.pile === "tab" ? cardY(L, h.i, h.index) : L.topY;
        drag = { from: h, cards, dx: ev.x - rx, dy: ev.y - ry, sx: ev.x, sy: ev.y, x: ev.x, y: ev.y, moved: false };
      } else if (ev.type === "pointermove" && drag) {
        drag.x = ev.x; drag.y = ev.y;
        if (Math.hypot(ev.x - drag.sx, ev.y - drag.sy) > 5) drag.moved = true;
      } else if (ev.type === "pointerup" && drag) {
        const d = drag; drag = null;
        if (!d.moved && Math.hypot(ev.x - d.sx, ev.y - d.sy) > 5) d.moved = true; // 移動の通知より先に離された場合
        if (!d.moved) { autoMove(d.from); return; }
        const L = layout();
        const target = dropTarget(ev.x - d.dx + L.cw / 2, ev.y - d.dy + L.ch / 2);
        if (!target || !tryMove(d.from, target)) message = "そこには置けません";
      }
    },
  };
});
