// render-v1 R-P1-pile の参照の作品。cannon-es の 3D の世界を z = 0 の面に制限して 2D で描く（1 単位 = 20px、y は下向き）。
// libraries: ["cannon-es@0.20.0"]
canvasApp.start((api) => {
  const S = 20, R = 12, MAX = 30, STEP = 1 / 120;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 1000 / S, 0) });
  world.defaultContactMaterial.friction = 0.3;
  world.defaultContactMaterial.restitution = 0.1;
  world.solver.iterations = 20;
  function wall(x, y, w, h) {
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2 / S, h / 2 / S, 2)) });
    b.position.set((x + w / 2) / S, (y + h / 2) / S, 0);
    world.addBody(b);
  }
  let balls = [], acc = 0;
  function layout() {
    for (const b of world.bodies.slice()) if (b.mass === 0) world.removeBody(b);
    wall(-100, api.height - 20, api.width + 200, 120);
    wall(-100, -400, 120, api.height + 400);
    wall(api.width - 20, -400, 120, api.height + 400);
  }
  layout();
  return {
    resize: layout,
    input(ev) {
      if (ev.type === "pointerdown" && balls.length < MAX) {
        const x = Math.min(api.width - 20 - R, Math.max(20 + R, ev.x));
        const b = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(R / S), linearDamping: 0.05, angularDamping: 0.3 });
        b.position.set(x / S, 40 / S, 0);
        b.linearFactor.set(1, 1, 0);
        b.angularFactor.set(0, 0, 1);
        world.addBody(b);
        balls.push(b);
      }
      if (ev.type === "keydown" && ev.code === "KeyR") {
        for (const b of balls) world.removeBody(b);
        balls = [];
      }
    },
    frame(t, dt) {
      acc = Math.min(acc + dt / 1000, 0.25);
      while (acc >= STEP) { world.step(STEP); acc -= STEP; }
      const c = api.ctx;
      c.fillStyle = "#000000";
      c.fillRect(0, 0, api.width, api.height);
      c.fillStyle = "#808080";
      c.fillRect(0, api.height - 20, api.width, 20);
      c.fillRect(0, 0, 20, api.height);
      c.fillRect(api.width - 20, 0, 20, api.height);
      c.fillStyle = "#ffffff";
      for (const b of balls) {
        c.beginPath();
        c.arc(b.position.x * S, b.position.y * S, R, 0, Math.PI * 2);
        c.fill();
      }
    },
  };
});
