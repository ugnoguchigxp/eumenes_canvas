canvasApp.start((api) => {
  // 自機の位置は地面からの高さ h で持つ。ジャンプは放物線（頂点 80px・滞空 0.7 秒）。
  const state = { h: 0, v: 0, list: [], timer: 1200, score: 0, over: false };
  const GRAV = 640 / 490000, JUMP = 320 / 700;
  const restart = () => Object.assign(state, { h: 0, v: 0, list: [], timer: 1200, score: 0, over: false });
  function update(dt, W, ground) {
    if (state.h > 0 || state.v !== 0) {
      state.v -= GRAV * dt;
      state.h = Math.max(0, state.h + state.v * dt);
      if (state.h === 0) state.v = 0;
    }
    state.timer -= dt;
    if (state.timer <= 0) { state.list.push({ x: W, counted: false }); state.timer = 1500 + api.random() * 1000; }
    for (const ob of state.list) ob.x -= 0.2 * dt;
    for (const ob of state.list) {
      if (!ob.counted && ob.x + 20 < 60) { ob.counted = true; state.score += 1; }
      const overlapX = ob.x < 80 && ob.x + 20 > 60;
      const overlapY = state.h < 30;
      if (overlapX && overlapY) state.over = true;
    }
    state.list = state.list.filter((ob) => ob.x > -40);
  }
  return {
    frame(t, dt) {
      const W = api.width, H = api.height, ground = H - 40;
      if (!state.over) update(dt, W, ground);
      const g = api.ctx;
      g.fillStyle = "#000000"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#808080"; g.fillRect(0, ground, W, 4);
      g.fillStyle = "#ff0000"; state.list.forEach((ob) => g.fillRect(ob.x, ground - 30, 20, 30));
      g.fillStyle = "#00ff00"; g.fillRect(60, ground - 20 - state.h, 20, 20);
      g.fillStyle = "#ffff00"; for (let i = 0; i < state.score && i < 40; i++) g.fillRect(4 + i * 10, 4, 8, 8);
      if (state.over) { g.fillStyle = "#400000"; g.fillRect(0, 0, W, H); g.fillStyle = "#ffffff"; g.font = "16px sans-serif"; g.fillText("ゲームオーバー（R）", 20, H / 2); }
    },
    input(ev) {
      if (ev.type === "keydown" && ev.code === "KeyR") restart();
      else if (ev.type === "keydown" && ev.code === "Space" && !state.over && state.h === 0) state.v = JUMP;
    },
  };
});
