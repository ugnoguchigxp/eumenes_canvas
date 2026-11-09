canvasApp.start((api) => {
  const GROUND = () => api.height - 40;
  const PW = 16, PH = 32, PX = 40, VMAX = 600, G = 600, BALLS = 5;
  let power, charging, ball, target, score, thrown, over;
  const newTarget = () => ({ x: 200 + api.random() * 240, w: 30, h: 30 });
  function reset() { power = 0; charging = false; ball = null; target = newTarget(); score = 0; thrown = 0; over = false; }
  reset();
  const isSpace = (ev) => ev.code === "Space" || ev.key === " ";
  function update(s) {
    if (over) return;
    if (charging) power = Math.min(1, power + s);
    if (ball) {
      ball.vy += G * s; ball.x += ball.vx * s; ball.y += ball.vy * s;
      const gy = GROUND();
      const tx = target.x, ty = gy - target.h;
      let gone = false;
      if (ball.x + 6 > tx && ball.x - 6 < tx + target.w && ball.y + 6 > ty && ball.y - 6 < gy) { score++; target = newTarget(); gone = true; }
      else if (ball.y + 6 >= gy || ball.x - 6 > api.width || ball.x + 6 < 0) gone = true;
      if (gone) { ball = null; if (thrown >= BALLS) over = true; }
    }
  }
  return {
    frame(t, dt) {
      if (dt > 0) update(dt / 1000);
      const c = api.ctx, W = api.width, H = api.height, gy = GROUND();
      c.fillStyle = over ? "#400000" : "#000000"; c.fillRect(0, 0, W, H);
      if (!over) {
        c.fillStyle = "#808080"; c.fillRect(0, gy, W, 4);
        c.fillStyle = "#00ff00"; c.fillRect(PX, gy - PH, PW, PH);
        c.fillStyle = "#ff0000"; c.fillRect(target.x, gy - target.h, target.w, target.h);
        c.fillStyle = "#ffffff";
        if (power > 0) c.fillRect(PX, gy + 4 + 8, 200 * power, 8);
        if (ball) { c.beginPath(); c.arc(ball.x, ball.y, 6, 0, Math.PI * 2); c.fill(); }
      }
      c.fillStyle = "#ffff00";
      for (let i = 0; i < score; i++) c.fillRect(8 + i * 12, 4, 8, 8);
    },
    input(ev) {
      if (ev.type === "keydown" && (ev.code === "KeyR" || ev.key === "r" || ev.key === "R")) { reset(); return; }
      if (over || !isSpace(ev)) return;
      if (ev.type === "keydown" && !ball && !charging) { charging = true; power = 0; }
      if (ev.type === "keyup" && charging) {
        charging = false;
        const v = VMAX * power;
        ball = { x: PX + PW, y: GROUND() - PH, vx: v / Math.SQRT2, vy: -v / Math.SQRT2 };
        thrown++; power = 0;
      }
    },
  };
});
