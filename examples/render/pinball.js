// デモ：3D ピンボール（Three.js ＋ cannon-es）。傾けた台を透視カメラで見下ろす。フリッパー 3 本（下の左右と左上）、溜めて打つプランジャー、
// スリングショット 2 個、光って弾くポップバンパー 3 個、上のロールオーバー 3 レーン（フリッパーで点灯位置を回せる）、ドロップターゲット 3 枚、
// 宙に浮いたワイヤーランプ（入ると球がランプを回って右のインレーンへ戻る）、倍率・ボールセーブ・残り球、得点板（HTML を api.decodeSVG で画像にし、
// 画面の左上と台の奥のバックボックスの面に写す）。音の代わりに光・火花・画面の揺れで当たりを見せる。
// 操作：Z / ← 左フリッパー（左上も）、/ / → 右フリッパー（M も可）、Space / ↓ 長押しで溜めて離して打つ、C でカメラ（全体 ⇄ 球に寄る）、R で最初から。
// タッチ：画面の左半分・右半分で左右のフリッパー、球が打ち出し口にあるときは右下を長押しして離すと打つ。
// libraries: ["three@0.187.0", "cannon-es@0.20.0"]
canvasApp.start((api) => {
  const BR = 0.16, BALLS = 3, CX = -0.25, TILT = 0.11, SAVE_S = 6;
  const V = THREE.Vector3;
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060d);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const table = new THREE.Group();
  table.rotation.x = TILT; // 奥を高く（見た目の傾き。物理は台の座標で、重力に手前への成分を入れる）
  scene.add(table);

  // 球の映り込み用の環境（球にだけ使う）
  let envTex = null;
  {
    const env = new THREE.Scene();
    const sky = new THREE.SphereGeometry(10, 16, 8), col = [], p = sky.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = (p.getY(i) / 10 + 1) / 2; col.push(0.1 + 0.3 * k, 0.08 + 0.3 * k, 0.2 + 0.6 * k); }
    sky.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    env.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    [[0, 8, 0, 0xffffff, 7], [6, 2, 4, 0xff6040, 3], [-6, 2, 3, 0x40a0ff, 3], [0, 3, -7, 0xffd040, 4]].forEach(([x, y, z, c, s]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    });
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromScene(env, 0.02).texture;
    pm.dispose();
  }
  scene.add(new THREE.HemisphereLight(0x8090ff, 0x201008, 0.9));
  scene.add(new THREE.AmbientLight(0x303040, 0.8));
  const sun = new THREE.DirectionalLight(0xfff0e0, 2.2);
  sun.position.set(-3, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 7, bottom: -7, near: 2, far: 30 });
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // ---- 台の絵（2D で描いてテクスチャにする） ----
  {
    const c = new OffscreenCanvas(512, 1024), g = c.getContext("2d");
    const X = (x) => ((x + 3) / 6) * 512, Z = (z) => ((z + 5.6) / 11.2) * 1024;
    const bg = g.createLinearGradient(0, 0, 0, 1024);
    bg.addColorStop(0, "#1a0b3d"); bg.addColorStop(0.5, "#0d1e5c"); bg.addColorStop(1, "#06102c");
    g.fillStyle = bg; g.fillRect(0, 0, 512, 1024);
    g.save(); g.translate(X(-0.25), Z(-2.0));
    for (let i = 0; i < 24; i++) { g.rotate(Math.PI / 12); g.fillStyle = i % 2 ? "rgba(255,200,80,0.10)" : "rgba(120,80,255,0.10)"; g.beginPath(); g.moveTo(0, 0); g.lineTo(600, -80); g.lineTo(600, 80); g.fill(); }
    g.restore();
    const rg = g.createRadialGradient(X(-0.25), Z(-2), 10, X(-0.25), Z(-2), 230);
    rg.addColorStop(0, "rgba(255,120,200,0.35)"); rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 512, 1024);
    g.strokeStyle = "rgba(120,200,255,0.5)"; g.lineWidth = 3;
    g.beginPath(); g.arc(X(-0.25), Z(1.2), 120, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.font = "bold 64px sans-serif"; g.textAlign = "center"; g.fillStyle = "rgba(255,210,90,0.85)";
    g.fillText("GROK", X(-0.25), Z(0.75));
    g.font = "bold 28px sans-serif"; g.fillStyle = "rgba(160,220,255,0.8)";
    g.fillText("PINBALL", X(-0.25), Z(1.1));
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(X(2.45), 0, 512 - X(2.45), 1024);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const pf = new THREE.Mesh(new THREE.PlaneGeometry(6, 11.2), new THREE.MeshPhongMaterial({ map: tex, shininess: 70, specular: 0x333344 }));
    pf.rotation.x = -Math.PI / 2;
    pf.receiveShadow = true;
    table.add(pf);
  }
  // 筐体：木の側板・手前のエプロン・奥のバックボックス
  const wood = new THREE.MeshPhongMaterial({ color: 0x5a2d14, shininess: 30 });
  const chrome = new THREE.MeshPhongMaterial({ color: 0xd8dde8, shininess: 120, specular: 0xffffff });
  [[-3.2, 0.4], [3.2, 0.4]].forEach(([x]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 11.6), wood); m.position.set(x, 0.2, 0); m.castShadow = true; table.add(m); });
  const apron = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.5, 0.8), new THREE.MeshPhongMaterial({ color: 0x14161f, shininess: 60 }));
  apron.position.set(0, 0.25, 5.8);
  table.add(apron);
  const backCanvas = new OffscreenCanvas(512, 256), backCtx = backCanvas.getContext("2d");
  const backTex = new THREE.CanvasTexture(backCanvas);
  backTex.colorSpace = THREE.SRGBColorSpace;
  const backbox = new THREE.Group();
  const bbBody = new THREE.Mesh(new THREE.BoxGeometry(6.8, 3.0, 0.8), wood);
  backbox.add(bbBody);
  const bbFace = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.5), new THREE.MeshBasicMaterial({ map: backTex }));
  bbFace.position.z = 0.41;
  backbox.add(bbFace);
  backbox.position.set(0, 1.6, -6.2);
  backbox.rotation.x = -TILT - 0.25;
  table.add(backbox);

  // ---- 物理 ----
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -60, 13) });
  world.allowSleep = false;
  const mBall = new CANNON.Material("ball"), mWall = new CANNON.Material("wall"), mFlip = new CANNON.Material("flip"), mBump = new CANNON.Material("bump"), mFloor = new CANNON.Material("floor");
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mFloor, { friction: 0.02, restitution: 0.05 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mWall, { friction: 0.04, restitution: 0.45 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mFlip, { friction: 0.15, restitution: 0.2 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mBall, mBump, { friction: 0, restitution: 0.9 }));
  const floor = new CANNON.Body({ mass: 0, material: mFloor, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const lid = new CANNON.Body({ mass: 0, material: mWall, shape: new CANNON.Plane() }); // ガラス（球が跳ね上がらない）
  lid.quaternion.setFromEuler(Math.PI / 2, 0, 0);
  lid.position.set(0, BR * 2.4, 0);
  world.addBody(lid);

  const railMat = new THREE.MeshPhongMaterial({ color: 0xc8d0e0, shininess: 100, specular: 0xffffff });
  function wall(x1, z1, x2, z2, opt = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1), th = opt.th ?? 0.06;
    const b = new CANNON.Body({ mass: 0, material: opt.mat ?? mWall, shape: new CANNON.Box(new CANNON.Vec3(len / 2 + th, 0.3, th)) });
    b.position.set((x1 + x2) / 2, 0.3, (z1 + z2) / 2);
    b.quaternion.setFromEuler(0, -ang, 0);
    world.addBody(b);
    if (opt.hidden) return b;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len + th * 2, opt.h ?? 0.3, th * 2), opt.material ?? railMat);
    m.position.set(b.position.x, (opt.h ?? 0.3) / 2, b.position.z);
    m.rotation.y = -ang;
    m.castShadow = true;
    table.add(m);
    b.userData = { mesh: m };
    return b;
  }
  wall(-3, -2.6, -3, 5.6);
  wall(3, -2.6, 3, 5.6);
  for (let i = 0; i < 18; i++) { // 奥の弧
    const a0 = (i / 18) * Math.PI, a1 = ((i + 1) / 18) * Math.PI;
    wall(3 * Math.cos(a0), -2.6 - 3 * Math.sin(a0), 3 * Math.cos(a1), -2.6 - 3 * Math.sin(a1), { th: 0.08 });
  }
  wall(-3, -3.05, -2.25, -2.62, { material: chrome, mat: mBump }); // 弧の左端の当て板（球をバンパーへ向ける）
  wall(2.45, -1.8, 2.45, 5.6);                              // 打ち出し口の仕切り
  wall(2.45, 4.98, 3, 4.98, { hidden: true });                 // プランジャーの面（球の受け）
  const gate = wall(2.45, -1.85, 3, -1.85, { hidden: true }); // 打ち出し口の一方通行の門
  wall(-3, 2.7, -1.62, 4.05, { material: chrome });         // インレーンのガイド
  wall(2.45, 2.7, 1.12, 4.05, { material: chrome });
  [-1.375, -0.625, 0.125, 0.875].forEach((x) => wall(x, -4.5, x, -3.9, { th: 0.04, material: chrome })); // 上のレーンの仕切り

  // スリングショット：三角の 2 辺は普通の壁、中央に向いた面で当たると弾く
  const slings = [];
  function sling(A, B, C, dirSign) {
    wall(A[0], A[1], B[0], B[1], { material: chrome });
    wall(B[0], B[1], C[0], C[1], { material: chrome });
    const k = wall(A[0], A[1], C[0], C[1], { mat: mBump, material: new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x000000, shininess: 60 }) });
    // 三角の面
    const sh = new THREE.Shape([new THREE.Vector2(A[0], A[1]), new THREE.Vector2(B[0], B[1]), new THREE.Vector2(C[0], C[1])]);
    const tri = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: false }), new THREE.MeshPhongMaterial({ color: dirSign > 0 ? 0xff3a6a : 0x3a9aff, emissive: 0x000000, shininess: 80 }));
    tri.rotation.x = Math.PI / 2;
    tri.position.y = 0.22;
    tri.castShadow = true;
    table.add(tri);
    const nx = C[1] - A[1], nz = -(C[0] - A[0]), nl = Math.hypot(nx, nz);
    const n = new V((nx / nl) * dirSign, 0, (nz / nl) * dirSign);
    slings.push({ b: k, n, flash: 0, tri, mesh: k.userData.mesh });
  }
  sling([-2.25, 1.75], [-2.25, 2.6], [-1.75, 3.0], -1);
  sling([1.75, 1.75], [1.75, 2.6], [1.25, 3.0], 1);

  // ポップバンパー
  const bumpers = [];
  const bumpCol = [0xff4060, 0x40c0ff, 0xffc030];
  [[-1.1, -2.5], [0.6, -2.5], [-0.25, -1.25]].forEach(([x, z], i) => {
    const b = new CANNON.Body({ mass: 0, material: mBump, shape: new CANNON.Cylinder(0.36, 0.36, 0.6, 16) });
    b.position.set(x, 0.3, z);
    world.addBody(b);
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.12, 24), new THREE.MeshPhongMaterial({ color: 0x222233 }));
    base.position.y = 0.06;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 24), new THREE.MeshPhongMaterial({ color: 0xeeeeee, shininess: 80 }));
    body.position.y = 0.25;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 8, 24), chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.33, 0.14, 24), new THREE.MeshPhongMaterial({ color: bumpCol[i], emissive: 0x000000, shininess: 100, specular: 0xffffff }));
    cap.position.y = 0.46;
    [base, body, cap].forEach((m) => (m.castShadow = true));
    g.add(base, body, ring, cap);
    g.position.set(x, 0, z);
    table.add(g);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), new THREE.MeshBasicMaterial({ color: bumpCol[i], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(x, 0.02, z);
    table.add(halo);
    bumpers.push({ b, cap, ring, halo, color: new THREE.Color(bumpCol[i]), flash: 0 });
  });

  // ドロップターゲット（右の壁ぎわ、左向き）
  const targets = [];
  [-0.75, -0.15, 0.45].forEach((z) => {
    const b = new CANNON.Body({ mass: 0, material: mWall, shape: new CANNON.Box(new CANNON.Vec3(0.07, 0.3, 0.24)) });
    b.position.set(2.3, 0.3, z);
    world.addBody(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.44), new THREE.MeshPhongMaterial({ color: 0xffe040, emissive: 0x332200, shininess: 90 }));
    m.position.set(2.3, 0.18, z);
    m.castShadow = true;
    table.add(m);
    targets.push({ b, m, down: false, y: 0.18 });
  });

  // 点灯する差し込みランプ（台の上の円）
  function insert(x, z, r, color) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ color }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, z);
    table.add(m);
    return { m, color: new THREE.Color(color), on: false };
  }
  const laneLights = [-1.0, -0.25, 0.5].map((x) => insert(x, -4.0, 0.13, 0x40ff90));
  const targetLights = [-0.75, -0.15, 0.45].map((z) => insert(1.95, z, 0.1, 0xffd040));
  const multLights = [2, 3, 4, 5].map((k, i) => insert(-1.0 + i * 0.5, 2.2, 0.14, 0xff5070));
  const rampLight = insert(-2.55, -1.15, 0.16, 0x50c0ff);
  const saveLight = insert(-0.25, 4.95, 0.18, 0xff9040);

  // フリッパー：支点が原点の運動学的な物体。形を腕の向きにずらし、刻みごとに角度を進める
  const OMEGA = 24;
  function flipper(px, pz, side, len, rest, up) {
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: mFlip });
    b.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, 0.15, 0.09)), new CANNON.Vec3((side * len) / 2, 0.15, 0));
    b.position.set(px, 0, pz);
    world.addBody(b);
    const sh = new THREE.Shape();
    sh.absarc(0, 0, 0.16, Math.PI / 2, (Math.PI * 3) / 2, false);
    sh.lineTo(len, -0.07);
    sh.absarc(len, 0, 0.07, -Math.PI / 2, Math.PI / 2, false);
    sh.lineTo(0, 0.16);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.24, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0.26, 0);
    if (side < 0) geo.scale(-1, 1, 1);
    const m = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0xf4f4f8, emissive: 0x000000, shininess: 90 }));
    m.castShadow = true;
    table.add(m);
    return { b, m, side, angle: rest, rest, up, held: false };
  }
  const flippers = [flipper(-1.62, 4.1, 1, 1.12, 0.5, -0.45), flipper(1.12, 4.1, -1, 1.12, 0.5, -0.45), flipper(-2.92, 0.35, 1, 0.75, 0.55, -0.3)];
  const leftFlips = [flippers[0], flippers[2]], rightFlips = [flippers[1]];
  function setFlipper(f, a, omega) {
    f.angle = a;
    f.b.quaternion.setFromEuler(0, -f.side * a, 0);
    f.b.angularVelocity.set(0, -f.side * omega, 0);
    f.m.position.copy(f.b.position);
    f.m.quaternion.copy(f.b.quaternion);
  }
  flippers.forEach((f) => setFlipper(f, f.rest, 0));
  function stepFlipper(f, s) {
    const target = f.held ? f.up : f.rest;
    if (Math.abs(f.angle - target) < 1e-4) return setFlipper(f, target, 0);
    const dir = Math.sign(target - f.angle), next = f.angle + dir * OMEGA * s;
    const done = dir > 0 ? next >= target : next <= target;
    setFlipper(f, done ? target : next, done ? 0 : dir * OMEGA);
  }

  // ワイヤーランプ（見た目は宙に浮いたレール、球は曲線に沿って動かす）
  const rampCurve = new THREE.CatmullRomCurve3([
    new V(-2.55, 0.05, -1.55), new V(-2.6, 0.45, -2.6), new V(-2.25, 0.95, -3.7), new V(-1.2, 1.25, -4.55), new V(0.4, 1.3, -4.6),
    new V(1.7, 1.15, -3.8), new V(2.1, 0.95, -2.2), new V(2.05, 0.7, 0.2), new V(1.95, 0.35, 1.6), new V(2.05, 0.05, 2.45)]);
  {
    const n = 120, l = [], r = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, p = rampCurve.getPointAt(u), t = rampCurve.getTangentAt(u), s = new V().crossVectors(t, new V(0, 1, 0)).normalize();
      l.push(p.clone().addScaledVector(s, 0.2).add(new V(0, 0.12, 0))); r.push(p.clone().addScaledVector(s, -0.2).add(new V(0, 0.12, 0))); bot.push(p.clone().add(new V(0, -0.12, 0)));
    }
    const wire = new THREE.MeshPhongMaterial({ color: 0xe8ecf8, shininess: 140, specular: 0xffffff });
    [l, r, bot].forEach((arr) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arr), 160, 0.03, 6), wire); m.castShadow = true; table.add(m); });
    for (let i = 10; i < n; i += 22) { // 支柱
      const p = bot[i];
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, p.y, 6), wire);
      post.position.set(p.x, p.y / 2, p.z);
      table.add(post);
    }
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.5), new THREE.MeshPhongMaterial({ color: 0x50c0ff, emissive: 0x103050, transparent: true, opacity: 0.8 }));
    flap.position.set(-2.55, 0.08, -1.8);
    flap.rotation.x = 0.25;
    table.add(flap);
  }

  // 球
  const ball = new CANNON.Body({ mass: 0.1, material: mBall, shape: new CANNON.Sphere(BR), linearDamping: 0.03 });
  world.addBody(ball);
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BR, 32, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08, envMap: envTex }));
  ballMesh.castShadow = true;
  table.add(ballMesh);
  // プランジャー（棒とばね）
  const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 12), new THREE.MeshPhongMaterial({ color: 0xff9020, shininess: 80 }));
  plunger.rotation.x = Math.PI / 2;
  table.add(plunger);
  const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 49 }, (_, k) => new V(Math.cos(k * 0.8) * 0.1, Math.sin(k * 0.8) * 0.1, k / 48))), 140, 0.018, 5), chrome);
  table.add(spring);

  // 火花（加算合成の点）
  const SP = 240, spPos = new Float32Array(SP * 3), spCol = new Float32Array(SP * 3), spVel = new Float32Array(SP * 3), spLife = new Float32Array(SP);
  const spGeo = new THREE.BufferGeometry();
  spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
  spGeo.setAttribute("color", new THREE.BufferAttribute(spCol, 3));
  const dot = (() => { // 丸くぼけた点の形
    const c = new OffscreenCanvas(64, 64), g = c.getContext("2d"), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(0.35, "rgba(255,255,255,0.7)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const sparks = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: 0.22, map: dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparks.frustumCulled = false;
  table.add(sparks);
  let spNext = 0;
  function burst(x, z, color, n = 24, speed = 4) {
    for (let i = 0; i < n; i++) {
      const k = spNext++ % SP, a = api.random() * Math.PI * 2, v = speed * (0.4 + api.random() * 0.8);
      spPos[k * 3] = x; spPos[k * 3 + 1] = 0.3; spPos[k * 3 + 2] = z;
      spVel[k * 3] = Math.cos(a) * v; spVel[k * 3 + 1] = 1 + api.random() * 3; spVel[k * 3 + 2] = Math.sin(a) * v;
      spLife[k] = 0.5 + api.random() * 0.4;
      spCol[k * 3] = color.r; spCol[k * 3 + 1] = color.g; spCol[k * 3 + 2] = color.b;
    }
  }

  // ---- 遊びの状態 ----
  let score = 0, ballsLeft = BALLS, mult = 1, charge = 0, charging = false, over = false, saveT = 0, launched = false;
  let msg = "", msgT = 0, shake = 0, onRamp = -1, rampCount = 0, bumperHits = 0, laneLit = [false, false, false], clock = 0;
  const say = (m, s = 1.6) => { msg = m; msgT = s; };
  const add = (p) => (score += p * mult);
  function serve() {
    ball.position.set(2.72, BR, 4.7);
    ball.velocity.setZero();
    ball.angularVelocity.setZero();
    launched = false;
    if (onRamp >= 0) { onRamp = -1; world.addBody(ball); }
  }
  function reset() {
    score = 0; ballsLeft = BALLS; mult = 1; over = false; rampCount = 0; bumperHits = 0; laneLit = [false, false, false];
    targets.forEach(raiseTarget);
    serve();
    say("SHOOT!", 2);
  }
  function raiseTarget(t) { t.down = false; t.b.collisionResponse = true; }
  const inLane = () => ball.position.x > 2.45 && ball.position.z > -1.8;
  ball.addEventListener("collide", (e) => {
    const o = e.body;
    const bump = bumpers.find((x) => x.b === o);
    if (bump) {
      const n = new V(ball.position.x - o.position.x, 0, ball.position.z - o.position.z).normalize();
      ball.velocity.set(n.x * 9.5, 0, n.z * 9.5);
      bump.flash = 0.22; shake = Math.max(shake, 0.06); bumperHits++;
      add(100);
      burst(o.position.x + n.x * 0.4, o.position.z + n.z * 0.4, bump.color, 40, 4.5);
      return;
    }
    const sl = slings.find((x) => x.b === o);
    if (sl) {
      ball.velocity.x = ball.velocity.x * 0.3 + sl.n.x * 8;
      ball.velocity.z = ball.velocity.z * 0.3 + sl.n.z * 8;
      sl.flash = 0.18; shake = Math.max(shake, 0.04);
      add(50);
      burst(ball.position.x, ball.position.z, new THREE.Color(0xffffff), 14, 3);
      return;
    }
    const tg = targets.find((x) => x.b === o);
    if (tg && !tg.down) {
      tg.down = true;
      // 当たった後の刻みで当たり判定を外す（この刻みの中では外さない）
      add(250);
      burst(tg.b.position.x - 0.1, tg.b.position.z, new THREE.Color(0xffe040), 16, 3);
      if (targets.every((t) => t.down)) { mult = Math.min(5, mult + 1); say(mult + "× MULTIPLIER"); add(1000); dropReset = 1.2; }
    }
  });
  let dropReset = 0, stuck = 0;

  // ---- 得点板（HTML → 画像）。変わったときだけ、間隔を空けて作り直す ----
  let panel = null, panelKey = "", panelPending = false, panelCool = 0;
  function panelSVG() {
    const W = 230, H = 112;
    const balls = Array.from({ length: BALLS }, (_, i) => '<span style="display:inline-block;width:12px;height:12px;border-radius:6px;margin-right:4px;background:' + (i < ballsLeft ? "radial-gradient(circle at 35% 35%,#fff,#9aa)" : "#334") + '"></span>').join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W * 2 + '" height="' + H * 2 + '" viewBox="0 0 ' + W + " " + H + '"><foreignObject width="' + W + '" height="' + H + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:' + W + 'px;height:' + H + 'px;padding:8px 12px;border-radius:14px;background:linear-gradient(160deg,rgba(40,10,70,.92),rgba(8,14,40,.92));border:2px solid #ffb830;color:#fff;font:13px sans-serif;box-shadow:0 0 12px #ff9020 inset">' +
      '<div style="display:flex;justify-content:space-between;color:#ffb830;font-weight:700;letter-spacing:2px"><span>GROK PINBALL</span><span style="color:#ff5a7a">' + mult + '×</span></div>' +
      '<div style="font:700 34px monospace;color:#fff6d0;text-shadow:0 0 8px #ff9020">' + String(score).padStart(7, "0") + '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><span>' + (over ? '<b style="color:#ff5060">GAME OVER</b>' : "BALL " + balls) + '</span><span style="color:#8fd0ff">RAMP ' + rampCount + '</span></div>' +
      '</div></foreignObject></svg>';
  }
  function updatePanel() {
    const k = score + "/" + ballsLeft + "/" + over + "/" + mult + "/" + rampCount;
    if (k === panelKey || panelPending || panelCool > 0) return;
    panelKey = k; panelPending = true; panelCool = 0.12;
    api.decodeSVG(panelSVG()).then((b) => {
      panelPending = false;
      if (panel) panel.close();
      panel = b;
      // バックボックスの面：同じ画像に飾りを足して写す
      const g = backCtx;
      const bg = g.createLinearGradient(0, 0, 512, 256);
      bg.addColorStop(0, "#2a0a4a"); bg.addColorStop(1, "#0a1a4a");
      g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
      g.font = "bold 40px sans-serif"; g.textAlign = "center"; g.fillStyle = "#ffcc40"; g.fillText("★ GROK ★", 256, 50);
      g.drawImage(b, 96, 70, 320, 156);
      backTex.needsUpdate = true;
    }, () => { panelPending = false; panelKey = ""; });
  }
  reset();
  updatePanel();

  function step(s) {
    if (charging) charge = Math.min(1, charge + s * 1.1);
    let left = Math.min(s, 0.1);
    while (left > 1e-6) {
      const h = Math.min(1 / 240, left);
      flippers.forEach((f) => stepFlipper(f, h));
      gate.collisionResponse = !(ball.position.x > 2.36 && ball.position.z > -2.3); // 球が門を抜けきるまでは閉じない
      targets.forEach((t) => (t.b.collisionResponse = !t.down));
      if (onRamp < 0) world.step(h);
      left -= h;
    }
    // ランプの入口：左上へ向かう球を拾う
    const p = ball.position;
    if (onRamp < 0 && p.x < -2.1 && p.x > -2.98 && p.z < -1.4 && p.z > -2.1 && ball.velocity.z < -1.5) {
      onRamp = 0; world.removeBody(ball); rampLight.on = true;
    }
    if (onRamp >= 0) {
      onRamp += s / 1.25;
      if (onRamp >= 1) {
        const e = rampCurve.getPointAt(1);
        world.addBody(ball);
        ball.position.set(e.x, BR, e.z); ball.velocity.set(-1.2, 0, 3.5); onRamp = -1; rampCount++;
        add(2500); say(rampCount % 3 === 0 ? "JACKPOT!" : "RAMP!"); if (rampCount % 3 === 0) add(10000);
        burst(e.x, e.z, new THREE.Color(0x50c0ff), 30, 3);
        rampLight.on = false;
      }
    }
    // 上のレーン
    if (p.z < -3.85 && p.z > -4.45) [-1.0, -0.25, 0.5].forEach((x, i) => { if (Math.abs(p.x - x) < 0.3 && !laneLit[i]) { laneLit[i] = true; add(500); burst(x, -4.1, new THREE.Color(0x40ff90), 10, 2); } });
    if (laneLit.every(Boolean)) { laneLit = [false, false, false]; add(5000); mult = Math.min(5, mult + 1); say("LANES  " + mult + "×"); }
    if (!launched && p.z < -1.9) { launched = true; saveT = SAVE_S; }
    if (saveT > 0) saveT -= s;
    // 止まった球を探して軽く弾く（台の上で引っかかったときの保険）
    stuck = onRamp < 0 && !inLane() && ball.velocity.length() < 0.3 ? stuck + s : 0;
    if (stuck > 2.5) { ball.velocity.set((api.random() - 0.5) * 3, 0, -4); stuck = 0; say("BALL SEARCH", 0.8); }
    if (dropReset > 0) { dropReset -= s; if (dropReset <= 0) targets.forEach(raiseTarget); }
    // 排出口
    if (onRamp < 0 && (p.z > 5.5 || Math.abs(p.x) > 3.4 || p.y < -1)) {
      if (saveT > 0 && launched) { say("BALL SAVED"); serve(); }
      else {
        ballsLeft--; mult = 1;
        if (ballsLeft <= 0) { ballsLeft = 0; over = true; say("GAME OVER", 99); ball.position.set(2.72, BR, 4.7); ball.velocity.setZero(); }
        else { say("BALL " + (BALLS - ballsLeft + 1)); serve(); }
      }
    }
    bumpers.forEach((b) => (b.flash = Math.max(0, b.flash - s)));
    slings.forEach((b) => (b.flash = Math.max(0, b.flash - s)));
    shake = Math.max(0, shake - s * 0.4);
    msgT = Math.max(0, msgT - s);
    panelCool -= s;
    for (let k = 0; k < SP; k++) if (spLife[k] > 0) {
      spLife[k] -= s;
      spVel[k * 3 + 1] -= 9 * s;
      for (let j = 0; j < 3; j++) spPos[k * 3 + j] += spVel[k * 3 + j] * s;
      if (spPos[k * 3 + 1] < 0.02) { spPos[k * 3 + 1] = 0.02; spVel[k * 3 + 1] *= -0.4; }
      spCol[k * 3] *= 0.97; spCol[k * 3 + 1] *= 0.97; spCol[k * 3 + 2] *= 0.97;
      if (spLife[k] <= 0) spPos[k * 3 + 1] = -50;
    }
  }

  let pointerSide = 0, closeCam = false, camInit = false;
  const camPos = new V(), camLook = new V(), camWant = new V(), lookWant = new V();
  function press(side, down) {
    (side < 0 ? leftFlips : rightFlips).forEach((f) => (f.held = down));
    // フリッパーで上のレーンの点灯位置を回す
    if (down) laneLit = side < 0 ? [laneLit[1], laneLit[2], laneLit[0]] : [laneLit[2], laneLit[0], laneLit[1]];
  }
  function startCharge() { if (over) { reset(); return; } if (inLane() && onRamp < 0) charging = true; }
  function release() {
    if (!charging) return;
    charging = false;
    if (inLane()) { const v = 9 + 15 * charge; ball.velocity.set(0, 0, -v); ball.angularVelocity.set(-v / BR, 0, 0); } // 転がりの回転も与える（滑りで速さを失わない）
    charge = 0;
  }
  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    input(ev) {
      const down = ev.type === "keydown", up = ev.type === "keyup";
      if (down || up) {
        const c = ev.code, k = ev.key;
        if (c === "ArrowLeft" || c === "KeyZ" || k === "z" || k === "Z") { if (down !== leftFlips[0].held) press(-1, down); }
        else if (c === "ArrowRight" || c === "Slash" || k === "/" || c === "KeyM" || k === "m" || k === "M") { if (down !== rightFlips[0].held) press(1, down); }
        else if (c === "Space" || k === " " || c === "ArrowDown") { if (down) startCharge(); else release(); }
        else if (down && (c === "KeyR" || k === "r" || k === "R")) reset();
        else if (down && (c === "KeyC" || k === "c" || k === "C")) closeCam = !closeCam;
        return;
      }
      if (ev.type === "pointerdown") {
        if (inLane() && ev.x > api.width * 0.66 && ev.y > api.height * 0.5) { pointerSide = 2; startCharge(); return; }
        if (over) { reset(); return; }
        pointerSide = ev.x < api.width / 2 ? -1 : 1;
        press(pointerSide, true);
      } else if (ev.type === "pointerup") {
        if (pointerSide === 2) release();
        else if (pointerSide) press(pointerSide, false);
        pointerSide = 0;
      }
    },
    frame(t, dt) {
      const s = Math.min(dt, 100) / 1000;
      if (dt > 0) { clock += s; step(s); }
      // 球
      if (onRamp >= 0) { const p = rampCurve.getPointAt(Math.min(1, onRamp)); ballMesh.position.set(p.x, p.y + BR * 0.6, p.z); }
      else { ballMesh.position.copy(ball.position); ballMesh.quaternion.copy(ball.quaternion); }
      // 光
      bumpers.forEach((b) => {
        const f = b.flash / 0.22;
        b.cap.material.emissive.copy(b.color).multiplyScalar(0.25 + 0.9 * f).addScalar(0.5 * f);
        b.halo.material.opacity = 0.15 + 0.7 * f;
        b.cap.position.y = 0.46 - 0.08 * f;
        b.ring.position.y = 0.2 - 0.12 * f;
      });
      slings.forEach((sl) => { const f = sl.flash / 0.18; sl.tri.material.emissive.setRGB(f * 0.8, f * 0.8, f * 0.8); sl.mesh.material.emissive.setRGB(f, f * 0.8, 0.2 * f); });
      targets.forEach((tg, i) => { tg.y += ((tg.down ? -0.17 : 0.18) - tg.y) * Math.min(1, s * 18 || 0); tg.m.position.y = tg.y; targetLights[i].on = tg.down; });
      const blink = Math.floor(clock * 6) % 2 === 0;
      laneLights.forEach((l, i) => (l.on = laneLit[i]));
      multLights.forEach((l, i) => (l.on = mult >= i + 2));
      saveLight.on = saveT > 0 && blink;
      [...laneLights, ...targetLights, ...multLights, rampLight, saveLight].forEach((l, i) => {
        const attract = over && Math.floor(clock * 8 + i) % 5 === 0;
        l.m.material.color.copy(l.color).multiplyScalar(l.on || attract ? 1.0 : 0.16);
      });
      flippers.forEach((f) => f.m.material.emissive.setHex(f.held ? 0x222244 : 0x000000));
      plunger.position.set(2.72, 0.14, 5.25 + charge * 0.35);
      spring.position.set(2.72, 0.14, 5.5 + charge * 0.35);
      spring.scale.set(1, 1, 0.6 - charge * 0.35);
      spGeo.attributes.position.needsUpdate = true;
      spGeo.attributes.color.needsUpdate = true;
      updatePanel();
      // カメラ：台の手前上から。球の位置で少しだけ追い、当たりで揺れる
      const narrow = api.width / api.height < 1;
      const bz = Math.max(-3, Math.min(3, ballMesh.position.z));
      const sx = (api.random() - 0.5) * shake, sy = (api.random() - 0.5) * shake;
      if (closeCam) { // 寄りのカメラ：球の少し手前上から追う（台の傾きに合わせて world 座標へ直す）
        const bx = ballMesh.position.x, bzz = Math.max(-4.2, Math.min(3.6, ballMesh.position.z));
        camWant.set(bx * 0.6 + CX * 0.4, 4.2, bzz + 4.6);
        lookWant.set(bx * 0.8 + CX * 0.2, 0, bzz - 0.9);
        table.localToWorld(camWant); table.localToWorld(lookWant);
        camera.fov = narrow ? 62 : 50;
      } else {
        camWant.set(CX + (ballMesh.position.x - CX) * 0.08, narrow ? 13.5 : 10.0, (narrow ? 11.5 : 11.0) + bz * 0.05);
        lookWant.set(CX + (ballMesh.position.x - CX) * 0.04, 0, -0.05 + bz * 0.07);
        camera.fov = narrow ? 58 : 42;
      }
      const a = dt > 0 ? 1 - Math.pow(0.9, dt / 16) : camInit ? 0 : 1;
      camInit = true;
      camPos.lerp(camWant, a); camLook.lerp(lookWant, a);
      camera.updateProjectionMatrix();
      camera.position.set(camPos.x + sx, camPos.y + sy, camPos.z);
      camera.lookAt(camLook);
      renderer.render(scene, camera);
      const c = api.ctx;
      c.drawImage(gl, 0, 0, api.width, api.height);
      // 2D の重ね描き：得点板（HTML の画像）・溜めのゲージ・見出し
      const pw = Math.min(230, api.width * 0.31), ph = (pw * 112) / 230;
      if (panel) c.drawImage(panel, 8, 8, pw, ph);
      if (charging || (inLane() && !over && onRamp < 0)) {
        const x = api.width - 34, y0 = api.height - 130;
        c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(x, y0, 18, 110);
        const grd = c.createLinearGradient(0, y0 + 110, 0, y0);
        grd.addColorStop(0, "#40ff90"); grd.addColorStop(0.6, "#ffd040"); grd.addColorStop(1, "#ff4060");
        c.fillStyle = grd; c.fillRect(x + 3, y0 + 107 - 104 * charge, 12, 104 * charge);
        c.fillStyle = "#fff"; c.font = "11px sans-serif"; c.textAlign = "center"; c.fillText("Space", x + 9, y0 - 6);
      }
      if (msgT > 0) {
        const a = Math.min(1, msgT * 3);
        c.save();
        c.globalAlpha = a;
        c.textAlign = "center"; c.textBaseline = "middle";
        c.font = "bold " + Math.round(Math.min(40, api.width / 12)) + "px sans-serif";
        c.shadowColor = "#ff9020"; c.shadowBlur = 18;
        c.fillStyle = blink ? "#fff6d0" : "#ffd040";
        c.fillText(msg, api.width / 2, api.height * 0.42);
        if (over) { c.font = "14px sans-serif"; c.shadowBlur = 0; c.fillStyle = "#fff"; c.fillText("Space / クリック / R で再スタート", api.width / 2, api.height * 0.42 + 34); }
        c.restore();
      }
      if (dt > 0 && Math.floor(t / 500) !== Math.floor((t - dt) / 500)) api.status({ t: Math.round(t), x: +ball.position.x.toFixed(2), z: +ball.position.z.toFixed(2), score, ballsLeft, mult, bumperHits, rampCount, onRamp: onRamp >= 0, over });
    },
  };
});
