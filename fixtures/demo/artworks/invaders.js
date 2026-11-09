// インベーダーゲーム（デモ用の固定応答。Grok Bot が制作担当を代行して作成）
canvasApp.start((api) => {
  // 論理座標 480×400 の盤面を、表示寸法に合わせて等倍率で拡大・縮小して描く
  const FW = 480, FH = 400;
  const COLS = 11, ROWS = 5;
  const INV_W = 24, INV_H = 16, GAP_X = 12, GAP_Y = 12;
  const PLAYER_Y = 370, PLAYER_W = 30, PLAYER_H = 12, PLAYER_SPEED = 0.22; // px/ms
  const SHOT_SPEED = 0.5, BOMB_SPEED = 0.16;
  const ROW_POINTS = [30, 20, 20, 10, 10];
  const ROW_COLORS = ["#ff5ad1", "#5ad1ff", "#5ad1ff", "#7dff5a", "#7dff5a"];
  const SHIELD_Y = 320, SHIELD_CELL = 4;
  const SHIELD_SHAPE = ["..######..", ".########.", "##########", "##########", "###....###", "##......##"];

  let invaders, dir, stepAcc, stepMs, player, shots, bombs, shields, score, lives, wave, over, dying, keys, bombAcc, frameFlip, seq, kills, banner;

  function makeWave() {
    invaders = [];
    const top = 50 + Math.min(4, wave - 1) * 12;
    const left = (FW - (COLS * INV_W + (COLS - 1) * GAP_X)) / 2;
    for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++)
      invaders.push({ x: left + q * (INV_W + GAP_X), y: top + r * (INV_H + GAP_Y), row: r, col: q, alive: true });
    dir = 1; stepAcc = 0; shots = []; bombs = []; bombAcc = 0;
    banner = 800;
  }
  function makeShields() {
    shields = [];
    for (let i = 0; i < 4; i++) {
      const sx = 60 + i * 110;
      SHIELD_SHAPE.forEach((row, ry) => [...row].forEach((ch, rx) => {
        if (ch === "#") shields.push({ x: sx + rx * SHIELD_CELL, y: SHIELD_Y + ry * SHIELD_CELL, hp: 2 });
      }));
    }
  }
  function reset() {
    score = 0; lives = 3; wave = 1; over = false; dying = 0; keys = {}; frameFlip = false; seq = 0; kills = 0;
    player = { x: FW / 2 };
    makeWave(); makeShields();
    report("start");
  }
  function report(event) {
    api.status({ game: "invaders", seq: ++seq, event, score, lives, wave, kills, alive: invaders.filter((v) => v.alive).length, over, playerX: Math.round(player.x) });
  }
  const alive = () => invaders.filter((v) => v.alive);
  function currentStepMs() {
    // 残りが少ないほど速く、波が進むほど速い
    const n = alive().length;
    return Math.max(40, (90 + n * 12) * Math.pow(0.9, wave - 1));
  }
  function stepFormation() {
    const a = alive();
    if (!a.length) return;
    const minX = Math.min(...a.map((v) => v.x)), maxX = Math.max(...a.map((v) => v.x + INV_W));
    const dx = 8 * dir;
    if (minX + dx < 8 || maxX + dx > FW - 8) {
      for (const v of a) v.y += 14;
      dir = -dir;
    } else for (const v of a) v.x += dx;
    frameFlip = !frameFlip;
    if (Math.max(...a.map((v) => v.y + INV_H)) >= PLAYER_Y - 4) { lives = 0; endGame(); }
    // 盾に触れた部分は削れる
    for (const v of a) for (const s of shields) if (s.hp > 0 && s.x < v.x + INV_W && s.x + SHIELD_CELL > v.x && s.y < v.y + INV_H && s.y + SHIELD_CELL > v.y) s.hp = 0;
  }
  function dropBomb() {
    const a = alive();
    if (!a.length) return;
    // 各列のいちばん下の敵から 1 体を選ぶ（自機の近くの列を少し選びやすくする）
    const bottoms = new Map();
    for (const v of a) if (!bottoms.has(v.col) || bottoms.get(v.col).y < v.y) bottoms.set(v.col, v);
    const cands = [...bottoms.values()];
    let pick = cands[Math.floor(api.random() * cands.length)];
    if (api.random() < 0.4) pick = cands.reduce((b, v) => (Math.abs(v.x - player.x) < Math.abs(b.x - player.x) ? v : b), cands[0]);
    bombs.push({ x: pick.x + INV_W / 2, y: pick.y + INV_H });
  }
  function hitShield(x, y, w, h) {
    for (const s of shields) if (s.hp > 0 && x < s.x + SHIELD_CELL && x + w > s.x && y < s.y + SHIELD_CELL && y + h > s.y) { s.hp--; return true; }
    return false;
  }
  function endGame() { over = true; report("gameover"); }
  function fire() {
    if (over || dying > 0 || banner > 0) return;
    if (shots.length >= 1) return; // 画面に 1 発まで
    shots.push({ x: player.x, y: PLAYER_Y - 6 });
  }

  function update(dt) {
    if (banner > 0) { banner -= dt; return; }
    if (dying > 0) {
      dying -= dt;
      if (dying <= 0) { if (lives <= 0) endGame(); else { bombs = []; player.x = FW / 2; } }
      return;
    }
    const mv = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    if (mv) player.x = Math.min(FW - PLAYER_W / 2 - 4, Math.max(PLAYER_W / 2 + 4, player.x + mv * PLAYER_SPEED * dt));
    else if (player.target !== undefined) {
      const d = player.target - player.x;
      player.x += Math.sign(d) * Math.min(Math.abs(d), PLAYER_SPEED * dt);
      if (Math.abs(player.target - player.x) < 0.5) { player.target = undefined; if (player.fireOnArrive) { player.fireOnArrive = false; fire(); } }
    }
    stepAcc += dt;
    stepMs = currentStepMs();
    while (stepAcc >= stepMs) { stepAcc -= stepMs; stepFormation(); if (over) return; }
    bombAcc += dt;
    const bombEvery = Math.max(350, 1100 - wave * 100);
    while (bombAcc >= bombEvery) { bombAcc -= bombEvery; if (bombs.length < 3 + wave) dropBomb(); }

    for (const s of shots) s.y -= SHOT_SPEED * dt;
    for (const b of bombs) b.y += BOMB_SPEED * dt;
    shots = shots.filter((s) => {
      if (s.y < 30) return false;
      if (hitShield(s.x - 1, s.y, 2, 8)) return false;
      for (const v of invaders) if (v.alive && s.x >= v.x && s.x <= v.x + INV_W && s.y <= v.y + INV_H && s.y + 8 >= v.y) {
        v.alive = false; score += ROW_POINTS[v.row]; kills++; report("kill");
        return false;
      }
      for (const b of bombs) if (!b.dead && Math.abs(b.x - s.x) < 4 && Math.abs(b.y - s.y) < 8) { b.dead = true; return false; }
      return true;
    });
    bombs = bombs.filter((b) => {
      if (b.dead || b.y > FH) return false;
      if (hitShield(b.x - 1, b.y, 3, 8)) return false;
      if (b.y + 8 >= PLAYER_Y && b.y <= PLAYER_Y + PLAYER_H && Math.abs(b.x - player.x) <= PLAYER_W / 2) {
        lives--; dying = 1000; shots = []; report("hit");
        return false;
      }
      return true;
    });
    if (!alive().length) { wave++; makeWave(); report("wave"); }
  }

  function drawInvader(c, v) {
    c.fillStyle = ROW_COLORS[v.row];
    const x = v.x, y = v.y, u = INV_W / 8;
    c.fillRect(x + u, y, u * 6, u * 3);
    c.fillRect(x, y + u * 1, u * 8, u * 2);
    c.fillStyle = "#000";
    c.fillRect(x + u * 2, y + u, u, u); c.fillRect(x + u * 5, y + u, u, u);
    c.fillStyle = ROW_COLORS[v.row];
    if (frameFlip) { c.fillRect(x, y + u * 3, u * 2, u); c.fillRect(x + u * 6, y + u * 3, u * 2, u); }
    else { c.fillRect(x + u * 2, y + u * 3, u, u); c.fillRect(x + u * 5, y + u * 3, u, u); }
  }

  reset();

  return {
    frame(t, dt) {
      if (!over) update(dt);
      const c = api.ctx;
      c.setTransform(api.dpr, 0, 0, api.dpr, 0, 0);
      c.fillStyle = "#000"; c.fillRect(0, 0, api.width, api.height);
      const s = Math.min(api.width / FW, api.height / FH);
      const ox = (api.width - FW * s) / 2, oy = (api.height - FH * s) / 2;
      c.setTransform(api.dpr * s, 0, 0, api.dpr * s, api.dpr * ox, api.dpr * oy);
      c.fillStyle = "#05050c"; c.fillRect(0, 0, FW, FH);
      c.fillStyle = "#fff"; c.font = "14px monospace"; c.textBaseline = "top";
      c.fillText("SCORE " + String(score).padStart(5, "0"), 10, 8);
      c.fillText("WAVE " + wave, FW / 2 - 28, 8);
      c.fillText("LIVES", FW - 120, 8);
      for (let i = 0; i < lives; i++) { c.fillStyle = "#5aff7d"; c.fillRect(FW - 64 + i * 20, 10, 14, 8); }
      for (const v of invaders) if (v.alive) drawInvader(c, v);
      for (const sh of shields) if (sh.hp > 0) { c.fillStyle = sh.hp === 2 ? "#3ccf4e" : "#1e7a2a"; c.fillRect(sh.x, sh.y, SHIELD_CELL, SHIELD_CELL); }
      if (!(dying > 0 && Math.floor(dying / 100) % 2)) {
        c.fillStyle = dying > 0 ? "#ff6040" : "#5aff7d";
        c.fillRect(player.x - PLAYER_W / 2, PLAYER_Y + 4, PLAYER_W, PLAYER_H - 4);
        c.fillRect(player.x - 3, PLAYER_Y, 6, 4);
      }
      c.fillStyle = "#fff"; for (const sh of shots) c.fillRect(sh.x - 1, sh.y, 2, 8);
      c.fillStyle = "#ffb040"; for (const b of bombs) { c.fillRect(b.x - 1, b.y, 3, 8); }
      c.fillStyle = "#5aff7d"; c.fillRect(0, PLAYER_Y + PLAYER_H + 4, FW, 2);
      c.fillStyle = "#8888a0"; c.font = "11px sans-serif";
      c.fillText("←→ 移動  Space 発射  クリックした位置へ移動して発射  R 最初から", 10, FH - 14);
      if (banner > 0 && !over) { c.fillStyle = "#fff"; c.font = "22px sans-serif"; c.fillText("WAVE " + wave, FW / 2 - 50, FH / 2 - 10); }
      if (over) {
        c.fillStyle = "rgba(0,0,0,0.75)"; c.fillRect(0, 0, FW, FH);
        c.fillStyle = "#ff5a5a"; c.font = "30px sans-serif"; c.fillText("GAME OVER", FW / 2 - 90, FH / 2 - 40);
        c.fillStyle = "#fff"; c.font = "16px sans-serif";
        c.fillText("SCORE " + score + "  WAVE " + wave, FW / 2 - 80, FH / 2 + 4);
        c.fillText("R かクリックで再開", FW / 2 - 70, FH / 2 + 30);
      }
      c.setTransform(api.dpr, 0, 0, api.dpr, 0, 0);
    },
    input(ev) {
      if (ev.type === "keydown") {
        if (ev.code === "KeyR" || (over && (ev.code === "Enter" || ev.code === "Space"))) { reset(); return; }
        if (ev.code === "ArrowLeft" || ev.code === "ArrowRight") { keys[ev.code] = true; player.target = undefined; }
        if (ev.code === "Space" || ev.code === "ArrowUp") fire();
      } else if (ev.type === "keyup") {
        keys[ev.code] = false;
      } else if (ev.type === "pointerdown") {
        if (over) { reset(); return; }
        const s = Math.min(api.width / FW, api.height / FH);
        const ox = (api.width - FW * s) / 2;
        player.target = Math.min(FW - PLAYER_W / 2 - 4, Math.max(PLAYER_W / 2 + 4, (ev.x - ox) / s));
        player.fireOnArrive = true;
      }
    },
  };
});
