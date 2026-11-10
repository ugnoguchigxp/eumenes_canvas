// デモ：ピンボール（物理）。傾いた台、プランジャー（Space を押して溜め、離して打つ）、左右のフリッパー（← →、または Z・M）、
// バンパー 3 個（当たると弾き返して 100 点）、得点と残り球の HTML パネル（api.decodeSVG）。R で最初から。
// libraries: ["three@0.187.0", "cannon-es@0.20.0"]
canvasApp.start((api) => {
  const BALL_R = 0.16, BALLS = 3, CX = -0.25;
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06070c);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xb0c0ff, 0x201810, 0.9));
  const key = new THREE.PointLight(0xffffff, 60, 30);
  key.position.set(0, 6, 2);
  scene.add(key);

  // 物理：台は XZ 平面（y が上）。+z が手前（排出口の側）。重力は台に押し付ける成分と手前へ転がす成分。
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -60, 14) });
  const mBall = new CANNON.Material("ball"), mWall = new CANNON.Material("wall"), mFlip = new CANNON.Material("flip"), mBump = new CANNON.Material("bump"), mFloor = new CANNON.Material("floor");
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mFloor, { friction: 0.02, restitution: 0.1 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mWall, { friction: 0.05, restitution: 0.45 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mFlip, { friction: 0.1, restitution: 0.25 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mBump, { friction: 0, restitution: 0.9 }));

  const floor = new CANNON.Body({ mass: 0, material: mFloor, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const lid = new CANNON.Body({ mass: 0, material: mWall, shape: new CANNON.Plane() });
  lid.quaternion.setFromEuler(Math.PI / 2, 0, 0);
  lid.position.set(0, BALL_R * 2.6, 0);
  world.addBody(lid);

  const table = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 10.6), new THREE.MeshStandardMaterial({ color: 0x14306a, roughness: 0.7 }));
  table.rotation.x = -Math.PI / 2;
  scene.add(table);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd8, roughness: 0.4, metalness: 0.3 });
  function wall(x1, z1, x2, z2, color) {
    const len = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1);
    const b = new CANNON.Body({ mass: 0, material: mWall, shape: new CANNON.Box(new CANNON.Vec3(len / 2, 0.3, 0.06)) });
    b.position.set((x1 + x2) / 2, 0.3, (z1 + z2) / 2);
    b.quaternion.setFromEuler(0, -ang, 0);
    world.addBody(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 0.12), color ? new THREE.MeshStandardMaterial({ color }) : wallMat);
    m.position.set(b.position.x, 0.15, b.position.z);
    m.rotation.y = -ang;
    scene.add(m);
  }
  wall(-3, -5.2, -3, 5.2);           // 左
  wall(3, -5.2, 3, 5.2);             // 右
  wall(-3, -5.2, 2.2, -5.2);         // 奥
  wall(2.2, -5.2, 3, -4.4);          // 右奥の角（打ち出した球を台へ向ける）
  wall(-3, -4.6, -2.4, -5.2);        // 左奥の角
  wall(2.5, -3.4, 2.5, 5.2);         // 打ち出しの通路の仕切り
  wall(-3, 2.6, -1.62, 3.75, 0xffc040);  // 左のガイド（フリッパーへ）
  wall(2.5, 2.6, 1.12, 3.75, 0xffc040);  // 右のガイド
  wall(2.5, 5.2, 3, 5.2);            // 通路の底

  // フリッパー：支点を原点とする運動学的な物体。形を支点から腕の向きにずらし、支点の回りに回す。
  const FL = 1.15, REST = 0.5, UP = -0.45, OMEGA = 22;
  function flipper(px, pz, side) {
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: mFlip });
    b.addShape(new CANNON.Box(new CANNON.Vec3(FL / 2, 0.15, 0.09)), new CANNON.Vec3((side * FL) / 2, 0.15, 0));
    b.position.set(px, 0, pz);
    world.addBody(b);
    const g = new THREE.BoxGeometry(FL, 0.25, 0.2);
    g.translate((side * FL) / 2, 0.13, 0);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xff3050, roughness: 0.3 }));
    scene.add(m);
    return { b, m, side, angle: REST, held: false };
  }
  const flippers = [flipper(-1.62, 3.75, 1), flipper(1.12, 3.75, -1)];
  function setFlipper(f, a, omega) {
    f.angle = a;
    // 左（side=1）は腕が +x、下向き（+z）が休み。右は腕が -x。
    f.b.quaternion.setFromEuler(0, -f.side * a, 0);
    f.b.angularVelocity.set(0, -f.side * omega, 0);
    f.m.position.copy(f.b.position);
    f.m.quaternion.copy(f.b.quaternion);
  }
  flippers.forEach((f) => setFlipper(f, REST, 0));
  function stepFlipper(f, s) {
    const target = f.held ? UP : REST;
    if (Math.abs(f.angle - target) < 1e-4) return setFlipper(f, target, 0);
    const dir = Math.sign(target - f.angle);
    const next = f.angle + dir * OMEGA * s;
    const done = dir > 0 ? next >= target : next <= target;
    setFlipper(f, done ? target : next, done ? 0 : dir * OMEGA);
  }

  // バンパー
  const bumpers = [];
  [[-1.3, -2.6], [0.8, -2.6], [-0.25, -1.2]].forEach(([x, z]) => {
    const b = new CANNON.Body({ mass: 0, material: mBump, shape: new CANNON.Cylinder(0.42, 0.42, 0.6, 16) });
    b.position.set(x, 0.3, z);
    world.addBody(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.4, 32), new THREE.MeshStandardMaterial({ color: 0x30e0a0, emissive: 0x000000 }));
    m.position.set(x, 0.2, z);
    scene.add(m);
    const bump = { b, m, flash: 0 };
    bumpers.push(bump);
  });

  // 球
  const ball = new CANNON.Body({ mass: 0.1, material: mBall, shape: new CANNON.Sphere(BALL_R), linearDamping: 0.05 });
  world.addBody(ball);
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.15 }));
  scene.add(ballMesh);
  const plungerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0xffa020 }));
  scene.add(plungerMesh);

  let score = 0, ballsLeft = BALLS, charge = 0, charging = false, over = false, panel = null, panelKey = "";
  function serve() {
    ball.position.set(2.75, BALL_R, 4.6);
    ball.velocity.setZero();
    ball.angularVelocity.setZero();
  }
  function reset() { score = 0; ballsLeft = BALLS; over = false; serve(); }
  reset();
  ball.addEventListener("collide", (e) => {
    const bump = bumpers.find((x) => x.b === e.body);
    if (!bump) return;
    const n = new CANNON.Vec3(ball.position.x - bump.b.position.x, 0, ball.position.z - bump.b.position.z);
    n.normalize();
    ball.velocity.set(n.x * 9, 0, n.z * 9); // 弾き返す
    bump.flash = 150;
    score += 100;
  });
  const inLane = () => ball.position.x > 2.5 && ball.position.z > 3.5;

  function updatePanel() {
    const k = score + "/" + ballsLeft + "/" + over;
    if (k === panelKey) return;
    panelKey = k;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="110"><foreignObject width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:150px;height:110px;padding:8px 12px;border-radius:12px;background:rgba(10,14,30,.85);border:2px solid #ffc040;color:#fff;font:14px sans-serif">' +
      '<div style="color:#ffc040;font-weight:700">PINBALL</div><div style="font:700 28px monospace">' + String(score).padStart(5, "0") + '</div>' +
      '<div>' + (over ? '<span style="color:#ff5060">GAME OVER — R</span>' : '球 ' + '●'.repeat(ballsLeft) + '○'.repeat(BALLS - ballsLeft)) + '</div></div></foreignObject></svg>';
    api.decodeSVG(svg).then((b) => { if (panel) panel.close(); panel = b; }, () => {});
  }
  updatePanel();

  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    input(ev) {
      const down = ev.type === "keydown", up = ev.type === "keyup";
      if (!down && !up) return;
      const c = ev.code, k = ev.key;
      if (c === "ArrowLeft" || c === "KeyZ" || k === "z" || k === "Z") flippers[0].held = down;
      if (c === "ArrowRight" || c === "KeyM" || k === "m" || k === "M") flippers[1].held = down;
      if (c === "Space" || k === " ") {
        if (down && inLane() && !over) charging = true;
        if (up && charging) {
          charging = false;
          if (inLane()) ball.velocity.set(0, 0, -(10 + 22 * charge));
          charge = 0;
        }
      }
      if (down && (c === "KeyR" || k === "r" || k === "R")) reset();
    },
    frame(t, dt) {
      if (dt > 0 && !over) {
        const s = dt / 1000;
        if (charging) charge = Math.min(1, charge + s);
        // 固定刻み 1/240 秒。フリッパーは刻みごとに回す。
        let left = Math.min(s, 0.1);
        while (left > 1e-6) {
          const h = Math.min(1 / 240, left);
          flippers.forEach((f) => stepFlipper(f, h));
          world.step(h);
          left -= h;
        }
        bumpers.forEach((b) => (b.flash = Math.max(0, b.flash - dt)));
        if (Math.floor(t / 500) !== Math.floor((t - dt) / 500)) api.status({ t: Math.round(t), x: +ball.position.x.toFixed(2), z: +ball.position.z.toFixed(2), v: +ball.velocity.length().toFixed(2), score, ballsLeft });
        if (ball.position.z > 5.4 || Math.abs(ball.position.x) > 3.4) {
          ballsLeft--;
          if (ballsLeft <= 0) { ballsLeft = 0; over = true; } else serve();
        }
      }
      ballMesh.position.copy(ball.position);
      bumpers.forEach((b) => b.m.material.emissive.setHex(b.flash > 0 ? 0x60ff90 : 0x000000));
      plungerMesh.position.set(2.75, 0.1, 5.0 + charge * 0.4);
      updatePanel();
      const wide = api.width / api.height;
      camera.position.set(CX, 12.5, wide < 1 ? 11 : 7.5);
      camera.fov = wide < 1 ? 55 : 46;
      camera.updateProjectionMatrix();
      camera.lookAt(CX, 0, 0.3);
      renderer.render(scene, camera);
      const c = api.ctx;
      c.drawImage(gl, 0, 0, api.width, api.height);
      if (panel) c.drawImage(panel, api.width - 160, 10);
      if (charging) { c.fillStyle = "#ffa020"; c.fillRect(api.width - 160, 126, 150 * charge, 8); }
    },
  };
});
