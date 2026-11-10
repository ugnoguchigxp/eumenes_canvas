// render-v1 R-P2-marbles の参照の作品。cannon-es の世界を z = 0 の面に制限して 2D で描く（1 単位 = 20px、y は下向き）。
// libraries: ["cannon-es@0.20.0"]
canvasApp.start((api) => {
  const S = 20, R = 8, MAX = 10, STEP = 1 / 120;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 600 / S, 0) });
  const solid = new CANNON.Material("solid"), glass = new CANNON.Material("glass");
  world.addContactMaterial(new CANNON.ContactMaterial(solid, glass, { friction: 0.05, restitution: 0.2 }));
  world.addContactMaterial(new CANNON.ContactMaterial(glass, glass, { friction: 0.02, restitution: 0.3 }));
  world.solver.iterations = 20;
  // 線分 (x1,y1)-(x2,y2)、太さ th の固い板
  function bar(x1, y1, x2, y2, th) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const b = new CANNON.Body({ mass: 0, material: solid, shape: new CANNON.Box(new CANNON.Vec3(len / 2 / S, th / 2 / S, 2)) });
    b.position.set((x1 + x2) / 2 / S, (y1 + y2) / 2 / S, 0);
    b.quaternion.setFromEuler(0, 0, Math.atan2(y2 - y1, x2 - x1));
    world.addBody(b);
  }
  const RAMPS = [[20, 90, 380, 190], [460, 230, 100, 330]];
  for (const r of RAMPS) bar(r[0], r[1], r[2], r[3], 8);
  bar(20 - 20, 60, 20 - 20, 400, 44); // 左の壁（内側の面が x = 22）
  bar(460 + 20, 60, 460 + 20, 400, 44); // 右の壁（内側の面が x = 458）
  bar(0, 350 + 20, 480, 350 + 20, 44); // 床（上面が y = 352 − 4 = 348）
  bar(20, 60 - 20, 460, 60 - 20, 4); // 見えない天井（はじかれた玉が外に出ないように）
  let marbles = [], clock = 0, acc = 0;
  function spawn() {
    if (marbles.length >= MAX) return;
    const b = new CANNON.Body({ mass: 1, material: glass, shape: new CANNON.Sphere(R / S), linearDamping: 0.01, angularDamping: 0.01 });
    b.position.set(40 / S, 60 / S, 0);
    b.linearFactor.set(1, 1, 0);
    b.angularFactor.set(0, 0, 1);
    world.addBody(b);
    marbles.push(b);
  }
  spawn();
  return {
    input(ev) {
      if (ev.type === "keydown" && ev.code === "Space") spawn();
    },
    frame(t, dt) {
      clock += dt;
      while (clock >= 1000) { clock -= 1000; spawn(); }
      acc = Math.min(acc + dt / 1000, 0.25);
      while (acc >= STEP) { world.step(STEP); acc -= STEP; }
      const c = api.ctx;
      c.fillStyle = "#000000";
      c.fillRect(0, 0, api.width, api.height);
      c.lineCap = "butt";
      c.strokeStyle = "#808080";
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(20, 60); c.lineTo(20, 350); c.moveTo(460, 60); c.lineTo(460, 350);
      c.moveTo(20, 350); c.lineTo(460, 350);
      c.stroke();
      c.strokeStyle = "#00ffff";
      c.lineWidth = 8;
      c.beginPath();
      for (const r of RAMPS) { c.moveTo(r[0], r[1]); c.lineTo(r[2], r[3]); }
      c.stroke();
      c.fillStyle = "#ffffff";
      for (const b of marbles) {
        c.beginPath();
        c.arc(b.position.x * S, b.position.y * S, R, 0, Math.PI * 2);
        c.fill();
      }
    },
  };
});
