// render-v1 R-P3-flipper の参照の作品。フリッパーは運動学的な物体（kinematic）で、支点の回りに回す。
// cannon-es の世界を z = 0 の面に制限して 2D で描く（1 単位 = 20px、y は下向き。角度は時計回りが正）。
// libraries: ["cannon-es@0.20.0"]
canvasApp.start((api) => {
  const S = 20, R = 8, STEP = 1 / 120, PX = 150, PY = 300, L = 100, TH = 14;
  const DOWN = Math.PI / 6, UP = -Math.PI / 6, SPEED = 20;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 600 / S, 0) });
  world.defaultContactMaterial.restitution = 0.2;
  world.defaultContactMaterial.friction = 0.1;
  world.solver.iterations = 20;
  function wall(x, y, w, h) {
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2 / S, h / 2 / S, 2)) });
    b.position.set((x + w / 2) / S, (y + h / 2) / S, 0);
    world.addBody(b);
  }
  wall(-100, -400, 120, 1200);
  wall(460, -400, 120, 1200);
  const flipper = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, shape: new CANNON.Box(new CANNON.Vec3(L / 2 / S, TH / 2 / S, 2)) });
  world.addBody(flipper);
  let angle = DOWN, held = false;
  const center = (a) => [(PX + (L / 2) * Math.cos(a)) / S, (PY + (L / 2) * Math.sin(a)) / S];
  function place() {
    const [cx, cy] = center(angle);
    flipper.position.set(cx, cy, 0);
    flipper.quaternion.setFromEuler(0, 0, angle);
    flipper.velocity.set(0, 0, 0);
    flipper.angularVelocity.set(0, 0, 0);
  }
  place();
  const ball = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(R / S) });
  ball.linearFactor.set(1, 1, 0);
  ball.angularFactor.set(0, 0, 1);
  world.addBody(ball);
  function drop() {
    ball.position.set(230 / S, 40 / S, 0);
    ball.velocity.set(0, 0, 0);
    ball.angularVelocity.set(0, 0, 0);
  }
  drop();
  let drains = 0, acc = 0;
  function step() {
    const target = held ? UP : DOWN;
    const next = angle + Math.max(-SPEED * STEP, Math.min(SPEED * STEP, target - angle));
    const [x0, y0] = center(angle), [x1, y1] = center(next);
    flipper.velocity.set((x1 - x0) / STEP, (y1 - y0) / STEP, 0);
    flipper.angularVelocity.set(0, 0, (next - angle) / STEP);
    world.step(STEP);
    angle = next;
    place();
    if (ball.position.y * S > api.height + R) { drains++; drop(); }
  }
  return {
    input(ev) {
      if (ev.code === "ArrowLeft" && (ev.type === "keydown" || ev.type === "keyup")) held = ev.type === "keydown";
    },
    frame(t, dt) {
      acc = Math.min(acc + dt / 1000, 0.25);
      while (acc >= STEP) { step(); acc -= STEP; }
      const c = api.ctx;
      c.fillStyle = "#000000";
      c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = "#808080";
      c.fillRect(0, 0, 20, api.height);
      c.fillRect(api.width - 20, 0, 20, api.height);
      c.save();
      c.translate(PX, PY);
      c.rotate(angle);
      c.fillStyle = "#ff0000";
      c.fillRect(0, -TH / 2, L, TH);
      c.restore();
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(ball.position.x * S, ball.position.y * S, R, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#ffff00";
      for (let i = 0; i < drains; i++) c.fillRect(8 + i * 12, 4, 8, 8);
    },
  };
});
