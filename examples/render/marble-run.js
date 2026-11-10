// デモ：3D マーブルラン（Three.js ＋ cannon-es）。らせん（2.5 周・バンク付き）→ 180° のヘアピン → 加速板 → 宙返り（横にずれるループ）
// → 折り返し → ゴール。ゴールに着いたビー玉はスクリューの昇降機で頂上へ戻り、走り続ける。コースは折れ線の亀（turtle）で作った
// 1 本の中心線から、見た目の樋（U 字の押し出し）と物理の箱（床・左右の壁）を同じ位置に作る。
// 操作：ドラッグ・←→↑↓ でカメラを回す、C でカメラ切替（周回 ⇄ 先頭を追う）、ビー玉をクリックするとそれを追う、Space で 1 個足す、R で最初から。
// libraries: ["three@0.187.0", "cannon-es@0.20.0"]
canvasApp.start((api) => {
  const MR = 0.17, W = 0.62, WALL_H = 0.3, TH = 0.07, MAX = 10;
  const V = THREE.Vector3;
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c1022);
  scene.fog = new THREE.Fog(0x0c1022, 16, 34);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);

  let envTex = null;
  // 映り込み用の環境：空のグラデーションと明るい板を PMREM で 1 回だけ焼く（ビー玉・金属の樋の艶）
  {
    const env = new THREE.Scene();
    const sky = new THREE.SphereGeometry(10, 24, 12);
    const col = [];
    const p = sky.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = (p.getY(i) / 10 + 1) / 2; col.push(0.05 + 0.5 * k, 0.07 + 0.45 * k, 0.15 + 0.7 * k); }
    sky.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    env.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    [[0, 8, 0, 0xffffff, 6], [7, 3, 3, 0xffc890, 3], [-6, 2, -5, 0x90b8ff, 3], [2, 1, -8, 0xff70c0, 2]].forEach(([x, y, z, c, s]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    });
    const pm = new THREE.PMREMGenerator(renderer);
    envTex = pm.fromScene(env, 0.03).texture; // ビー玉だけに使う（全体に掛けるとソフトウェア描画で重い）
    pm.dispose();
  }
  scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x403020, 1.1));
  scene.add(new THREE.AmbientLight(0x404660, 0.6));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
  sun.position.set(6, 14, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 2, far: 40 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // 床：円形の台座（2D で描いた模様のテクスチャ）
  {
    const c = new OffscreenCanvas(512, 512), g = c.getContext("2d");
    g.fillStyle = "#1b2238"; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = "rgba(120,150,255,0.25)"; g.lineWidth = 2;
    for (let i = 0; i <= 512; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
    const rg = g.createRadialGradient(256, 256, 20, 256, 256, 256);
    rg.addColorStop(0, "rgba(255,180,90,0.25)"); rg.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = rg; g.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(11, 64), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // ---- コースの中心線（亀） ----
  const pts = [], ups = [], sect = [];
  let pos = new V(1.7, 8.5, 3.3), dir = new V(0, 0, -1);
  const Y = new V(0, 1, 0);
  const leftOf = (d) => new V(d.z, 0, -d.x);
  const push = (p, u, tag) => { pts.push(p.clone()); ups.push(u.clone().normalize()); sect.push(tag); };
  push(pos, Y, "start");
  function straight(L, drop, tag = "straight") {
    const n = Math.max(2, Math.ceil(L / 0.25)), p0 = pos.clone();
    for (let k = 1; k <= n; k++) push(p0.clone().addScaledVector(dir, (L * k) / n).setY(p0.y - (drop * k) / n), Y, tag);
    pos = pts[pts.length - 1].clone();
  }
  function arc(R, ang, drop, bank, tag = "arc") {
    const sg = Math.sign(ang), c = pos.clone().addScaledVector(leftOf(dir), R * sg), o0 = pos.clone().sub(c), d0 = dir.clone(), y0 = pos.y;
    const n = Math.max(4, Math.ceil((Math.abs(ang) * R) / 0.2));
    for (let k = 1; k <= n; k++) {
      const a = (ang * k) / n, o = o0.clone().applyAxisAngle(Y, a);
      const p = c.clone().add(o).setY(y0 - (drop * k) / n);
      const ramp = Math.min(1, Math.min(k / n, 1 - k / n) / 0.12);
      const b = bank * ramp, inward = o.clone().setY(0).normalize().negate();
      push(p, Y.clone().multiplyScalar(Math.cos(b)).addScaledVector(inward, Math.sin(b)), tag);
      dir = d0.clone().applyAxisAngle(Y, a);
    }
    pos = pts[pts.length - 1].clone();
  }
  function loop(R, shift) {
    const p0 = pos.clone(), L = leftOf(dir), n = 40;
    for (let k = 1; k <= n; k++) {
      const th = (2 * Math.PI * k) / n, lat = (shift * (th - Math.sin(th))) / (2 * Math.PI);
      const p = p0.clone().addScaledVector(dir, R * Math.sin(th)).addScaledVector(Y, R * (1 - Math.cos(th))).addScaledVector(L, lat);
      const c = p0.clone().addScaledVector(Y, R).addScaledVector(L, lat);
      push(p, c.sub(p), "loop");
    }
    pos = pts[pts.length - 1].clone();
  }
  straight(3.3, 0.4, "chute");
  arc(1.7, 5 * Math.PI, 3.1, 0.3, "helix");      // らせん 2.5 周（左回り）
  straight(1.2, 0.18);
  arc(1.05, -Math.PI, 0.28, 0.38, "hairpin");     // 右へ 180°
  straight(1.0, 0.25);
  straight(2.4, 0.55, "boost");                   // 加速板つきの下り
  straight(0.8, 0.09, "boost");                   // 角を作らないよう傾きを 2 段で戻す
  loop(0.58, -1.05);                              // 宙返り（右へずれる）
  straight(0.8, 0.12);
  arc(1.2, -Math.PI / 2, 0.2, 0.3);
  straight(2.6, 0.32);
  arc(1.2, -Math.PI / 2, 0.2, 0.3);
  straight(2.2, 0.35, "wave");
  arc(1.0, Math.PI / 2, 0.2, 0.3);
  straight(0.9, 0.1, "goal");
  const N = pts.length;

  // 各点の向き（接線・上・右）
  const T = [], U = [], S = [];
  for (let i = 0; i < N; i++) {
    const t = pts[Math.min(N - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
    const u = ups[i].clone().addScaledVector(t, -ups[i].dot(t)).normalize();
    T.push(t); U.push(u); S.push(t.clone().cross(u));
  }

  // ---- 物理 ----
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.allowSleep = false;
  const mTrack = new CANNON.Material("track"), mMarble = new CANNON.Material("marble");
  world.addContactMaterial(new CANNON.ContactMaterial(mTrack, mMarble, { friction: 0.05, restitution: 0.15 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mMarble, mMarble, { friction: 0.02, restitution: 0.5 }));
  // 区間ごとに 1 つの静的な物体へ箱をまとめる（broadphase の組を減らす。形ごとの判定は境界球で先に絞られる）
  const bodies = [];
  let body = null;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < N - 1; i++) {
    if (i % 24 === 0) { body = new CANNON.Body({ mass: 0, material: mTrack }); bodies.push(body); world.addBody(body); }
    const a = pts[i], b = pts[i + 1], t = b.clone().sub(a), len = t.length();
    t.normalize();
    const u0 = U[i].clone().add(U[i + 1]);
    const u = u0.addScaledVector(t, -u0.dot(t)).normalize(), s = t.clone().cross(u);
    q.setFromRotationMatrix(m4.makeBasis(t, u, s));
    const cq = new CANNON.Quaternion(q.x, q.y, q.z, q.w), mid = a.clone().add(b).multiplyScalar(0.5);
    const hl = len / 2 + 0.03;
    const add = (he, off) => { const c = mid.clone().addScaledVector(u, off.y).addScaledVector(s, off.z); body.addShape(new CANNON.Box(new CANNON.Vec3(hl, he.y, he.z)), new CANNON.Vec3(c.x, c.y, c.z), cq); };
    add({ y: TH, z: W / 2 + 0.08 }, { y: -TH, z: 0 });                         // 床
    add({ y: WALL_H / 2 + 0.06, z: 0.04 }, { y: WALL_H / 2, z: W / 2 + 0.04 });  // 右の壁
    add({ y: WALL_H / 2 + 0.06, z: 0.04 }, { y: WALL_H / 2, z: -W / 2 - 0.04 }); // 左の壁
    if (sect[i] === "loop") add({ y: 0.04, z: W / 2 + 0.08 }, { y: 2 * MR + 0.16, z: 0 }); // ループは蓋つき（筒）
  }
  { // ゴールの止め
    const e = pts[N - 1].clone().addScaledVector(T[N - 1], 0.15);
    const stop = new CANNON.Body({ mass: 0, material: mTrack, shape: new CANNON.Box(new CANNON.Vec3(0.05, 0.4, W / 2 + 0.1)) });
    stop.position.set(e.x, e.y + 0.2, e.z);
    stop.quaternion.setFromEuler(0, Math.atan2(-T[N - 1].z, T[N - 1].x), 0);
    world.addBody(stop);
  }

  // ---- 見た目の樋：U 字の断面を中心線に沿って押し出す（辺ごとに頂点を分けて角を立てる） ----
  {
    const prof = [[-W / 2 - 0.08, WALL_H], [-W / 2 - 0.08, -2 * TH], [W / 2 + 0.08, -2 * TH], [W / 2 + 0.08, WALL_H], [W / 2, WALL_H], [W / 2, 0], [-W / 2, 0], [-W / 2, WALL_H]];
    const posA = [], colA = [], idx = [];
    const col = new THREE.Color();
    for (let e = 0; e < prof.length; e++) {
      const [s0, u0] = prof[e], [s1, u1] = prof[(e + 1) % prof.length];
      const base = posA.length / 3;
      for (let i = 0; i < N; i++) {
        const tag = sect[i];
        col.setHSL(tag === "loop" ? 0.9 : tag === "boost" ? 0.08 : (i / N) * 0.75 + 0.5, 0.85, e >= 4 ? 0.6 : 0.47);
        for (const [s, u] of [[s0, u0], [s1, u1]]) {
          const p = pts[i].clone().addScaledVector(S[i], s).addScaledVector(U[i], u);
          posA.push(p.x, p.y, p.z); colA.push(col.r, col.g, col.b);
        }
        if (i < N - 1) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(posA, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(colA, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x666666, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    // 支柱：らせんは中心柱からの腕、ほかは真下に別の区間が無い点だけ床まで
    const sup = [], arms = [];
    const hc = (() => { const i0 = sect.indexOf("helix"); return pts[i0 - 1].clone().addScaledVector(leftOf(T[i0 - 1]), 1.7); })();
    for (let i = 3; i < N; i += 6) {
      if (sect[i] === "loop") continue;
      if (sect[i] === "helix") { arms.push(i); continue; }
      const p = pts[i];
      const blocked = pts.some((o, j) => Math.abs(j - i) > 4 && o.y < p.y - 0.2 && Math.hypot(o.x - p.x, o.z - p.z) < 0.6) || Math.hypot(p.x - hc.x, p.z - hc.z) < 2.3;
      if (!blocked) sup.push(i);
    }
    const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.05, 1, 8), new THREE.MeshPhongMaterial({ color: 0x9aa4b8, shininess: 80 }), sup.length + arms.length);
    sup.forEach((i, k) => {
      const p = pts[i].clone().addScaledVector(U[i], -2 * TH);
      m4.compose(new V(p.x, p.y / 2, p.z), new THREE.Quaternion(), new V(1, p.y, 1));
      inst.setMatrixAt(k, m4);
    });
    arms.forEach((i, k) => {
      const p = pts[i].clone().addScaledVector(U[i], -2 * TH), a = new V(hc.x, p.y - 0.25, hc.z), d = p.clone().sub(a);
      m4.compose(a.clone().add(p).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()), new V(1, d.length(), 1));
      inst.setMatrixAt(sup.length + k, m4);
    });
    inst.castShadow = true;
    scene.add(inst);
    // 加速板の光る矢羽
    const chev = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 });
    const chevs = [];
    for (let i = 0; i < N; i++) if (sect[i] === "boost" && i % 2 === 0) {
      const sh = new THREE.Shape([new THREE.Vector2(-0.1, -0.18), new THREE.Vector2(0.08, 0), new THREE.Vector2(-0.1, 0.18), new THREE.Vector2(-0.02, 0)]);
      const cm = new THREE.Mesh(new THREE.ShapeGeometry(sh), chev.clone());
      const t = T[i], u = U[i], s = S[i];
      cm.quaternion.setFromRotationMatrix(m4.makeBasis(t, s.clone().negate(), u));
      cm.position.copy(pts[i]).addScaledVector(u, 0.005);
      scene.add(cm);
      chevs.push(cm);
    }
    scene.userData.chevs = chevs;
  }
  // らせんの中心柱と頂上の飾り
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 8.6, 32), new THREE.MeshPhongMaterial({ color: 0x5a6a9a, shininess: 90, specular: 0x8899cc }));
  pillar.position.set(0, 4.3, -1.7 + 1.7);
  { // らせんの中心はコースの作り方から決まる（chute の終点の左 1.7）
    const i0 = sect.indexOf("helix");
    const c = pts[i0 - 1].clone().addScaledVector(leftOf(T[i0 - 1]), 1.7);
    pillar.position.set(c.x, (pts[i0].y + 0.4) / 2, c.z);
    pillar.scale.y = (pts[i0].y + 0.4) / 8.6;
  }
  pillar.castShadow = pillar.receiveShadow = true;
  scene.add(pillar);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshPhongMaterial({ color: 0xffc040, emissive: 0x6a3a00, shininess: 120, specular: 0xffffff, flatShading: true }));
  crown.position.copy(pillar.position).setY(pillar.scale.y * 8.6 + 0.5);
  crown.castShadow = true;
  scene.add(crown);

  // ---- 昇降機：ゴールの横からスタートの手前までのガラス管とスクリュー ----
  const LIFT = new V(pts[0].x + 0.75, 0, pts[0].z + 0.2);
  const liftBottom = 0.5, liftTop = pts[0].y + 0.25, liftR = 0.3;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, liftTop - liftBottom + 0.6, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xaad8ff, transparent: true, opacity: 0.18, metalness: 0.1, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
  tube.position.set(LIFT.x, (liftTop + liftBottom) / 2, LIFT.z);
  scene.add(tube);
  const screwPts = [];
  for (let k = 0; k <= 160; k++) { const a = k * 0.42, y = liftBottom + ((liftTop - liftBottom) * k) / 160; screwPts.push(new V(Math.cos(a) * 0.36, y, Math.sin(a) * 0.36)); }
  const screw = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(screwPts), 320, 0.05, 6), new THREE.MeshStandardMaterial({ color: 0xff6a3a, metalness: 0.6, roughness: 0.3 }));
  screw.position.set(LIFT.x, 0, LIFT.z);
  screw.castShadow = true;
  scene.add(screw);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, liftTop - liftBottom, 8), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 }));
  axle.position.copy(tube.position);
  scene.add(axle);

  // ---- ビー玉 ----
  const palette = [0xff3b5c, 0x36c9ff, 0xffd23f, 0x7dff5a, 0xc86bff, 0xff8a2a, 0xffffff, 0x2affc8, 0xff5ad1, 0x5a7dff];
  const sphereGeo = new THREE.SphereGeometry(MR, 32, 20);
  // ビー玉の模様（白い渦）。色は材質の色で掛ける。転がる向きが見える
  const swirl = (() => {
    const c = new OffscreenCanvas(256, 128), g = c.getContext("2d");
    g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, 256, 128);
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = k === 1 ? "rgba(255,255,255,0.95)" : "rgba(90,90,90,0.6)"; g.lineWidth = k === 1 ? 14 : 6;
      g.beginPath();
      for (let x = 0; x <= 256; x += 4) { const y = 64 + Math.sin((x / 256) * Math.PI * 4 + k * 1.3) * 34; x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  })();
  let marbles = [], spawned = 0, laps = 0, nextSpawn = 0, maxSpeed = 0;
  const trail = new THREE.Group();
  scene.add(trail);
  function makeMarble(i) {
    const b = new CANNON.Body({ mass: 0.05, material: mMarble, shape: new CANNON.Sphere(MR), linearDamping: 0.2, angularDamping: 0.05 });
    const m = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ map: swirl, color: palette[i % palette.length], metalness: 0.25, roughness: 0.06, envMap: envTex, envMapIntensity: 1.6 }));
    m.castShadow = true;
    scene.add(m);
    return { b, m, id: i, state: "queue", u: 0, idx: 0, still: 0, from: new V() };
  }
  function place(mb) {
    const p = pts[0].clone().addScaledVector(T[0], 0.25).addScaledVector(U[0], MR + 0.02);
    mb.b.position.set(p.x, p.y, p.z);
    mb.b.velocity.set(T[0].x * 0.8, 0, T[0].z * 0.8);
    mb.b.angularVelocity.setZero();
    world.addBody(mb.b);
    mb.state = "run"; mb.idx = 0; mb.still = 0;
  }
  function addMarble() { if (marbles.length < MAX) marbles.push(makeMarble(spawned++)); }
  function reset() {
    for (const mb of marbles) { if (mb.state === "run") world.removeBody(mb.b); scene.remove(mb.m); mb.m.material.dispose(); }
    marbles = []; spawned = 0; laps = 0; nextSpawn = 0; maxSpeed = 0;
    for (let i = 0; i < 6; i++) addMarble();
  }
  reset();
  const tmp = new V();
  function nearest(mb) {
    // 前回の位置の前後だけを探す（コースは 1 本なので十分）
    let best = mb.idx, bd = Infinity;
    for (let i = Math.max(0, mb.idx - 6); i < Math.min(N, mb.idx + 14); i++) {
      const d = tmp.set(mb.b.position.x, mb.b.position.y, mb.b.position.z).distanceToSquared(pts[i]);
      if (d < bd) { bd = d; best = i; }
    }
    mb.idx = best;
    return bd;
  }
  function toLift(mb) { world.removeBody(mb.b); mb.state = "lift"; mb.u = 0; mb.from.set(mb.b.position.x, mb.b.position.y, mb.b.position.z); }

  function step(s) {
    // スタートが空いていれば、待っているビー玉を 1 個出す（間隔 0.9 秒）
    nextSpawn -= s;
    const startBusy = marbles.some((m) => m.state === "run" && m.idx < 4);
    if (nextSpawn <= 0 && !startBusy) {
      const w = marbles.find((m) => m.state === "queue");
      if (w) { place(w); nextSpawn = 0.9; }
    }
    for (const mb of marbles) {
      if (mb.state !== "run") continue;
      const tag = sect[mb.idx];
      mb.b.linearDamping = tag === "boost" || tag === "loop" ? 0.0 : 0.12;
      if (tag === "loop") { // ループの中は最低の速さを保つ（宙返りの途中で落ちて詰まらないように）
        const t = T[mb.idx], v = mb.b.velocity, along = v.x * t.x + v.y * t.y + v.z * t.z;
        if (along < 3.6) { const k = Math.min(3.6 - along, 30 * s); v.x += t.x * k; v.y += t.y * k; v.z += t.z * k; }
      }
      if (tag === "boost") { // 加速板：接線方向の速さを 7.2 まで上げる
        const t = T[mb.idx], v = mb.b.velocity, along = v.x * t.x + v.y * t.y + v.z * t.z;
        if (along < 7.2) { const k = Math.min(7.2 - along, 22 * s); v.x += t.x * k; v.y += t.y * k; v.z += t.z * k; }
      }
    }
    world.step(1 / 120, s, 8);
    for (const mb of marbles) {
      if (mb.state === "run") {
        const d2 = nearest(mb), v = mb.b.velocity.length();
        maxSpeed = Math.max(maxSpeed, v);
        // 止まったら接線方向へそっと押す（詰まりの保険）、コースから落ちたら昇降機へ
        mb.still = v < 0.08 ? mb.still + s : 0;
        if (mb.still > 1.5 && mb.idx < N - 3) { const t = T[mb.idx]; mb.b.velocity.set(t.x * 1.2, t.y * 1.2 + 0.4, t.z * 1.2); mb.still = 0; }
        if (mb.idx >= N - 2 || d2 > 4 || mb.b.position.y < -1) { if (mb.idx >= N - 2) laps++; toLift(mb); }
      } else if (mb.state === "lift") {
        mb.u += s / 3.6;
        if (mb.u >= 1) {
          const busy = marbles.some((m) => m.state === "run" && m.idx < 4);
          if (!busy) place(mb); else mb.u = 1;
        }
      }
    }
  }
  function liftPos(mb, out) {
    const u = mb.u;
    if (u < 0.12) { // ゴールから昇降機の下へ転がり込む
      const k = u / 0.12;
      return out.set(LIFT.x + Math.cos(0) * liftR, liftBottom, LIFT.z).lerp(mb.from, 1 - k);
    }
    if (u > 0.93) { // 頂上からスタートへ渡す
      const k = (u - 0.93) / 0.07, a = new V(LIFT.x + liftR, liftTop, LIFT.z), b = pts[0].clone().addScaledVector(U[0], MR + 0.05);
      return out.copy(a).lerp(b, Math.min(1, k)).setY(Math.max(a.y, b.y) + Math.sin(Math.min(1, k) * Math.PI) * 0.15);
    }
    const k = (u - 0.12) / 0.81, ang = k * 160 * 0.42 + screwAngle;
    return out.set(LIFT.x + Math.cos(ang) * liftR, liftBottom + (liftTop - liftBottom) * k, LIFT.z + Math.sin(ang) * liftR);
  }

  // ---- カメラ ----
  let yaw = 2.9, pitch = 0.32, dist = 14.5, mode = "orbit", follow = -1, lastDrag = -1e9, drag = null, screwAngle = 0, clock = 0;
  const keys = new Set();
  const camPos = new V(), camLook = new V(0, 4, 0), wantPos = new V(), wantLook = new V();
  let camInit = false;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const loopStart = sect.indexOf("loop"), loopEnd = sect.lastIndexOf("loop"), helixEnd = sect.lastIndexOf("helix");
  const helixC = (() => { const i0 = sect.indexOf("helix"); return pts[i0 - 1].clone().addScaledVector(leftOf(T[i0 - 1]), 1.7); })();
  const bbox = new THREE.Box3().setFromPoints(pts), bc = bbox.getCenter(new V()), bR = bbox.getSize(new V()).length() / 2;
  bc.y += 0.2;
  function leader() {
    let best = null;
    for (const mb of marbles) if (mb.state === "run" && (!best || mb.idx > best.idx)) best = mb;
    return best;
  }
  function cameraTarget() {
    const fm = mode === "follow" ? (marbles.find((m) => m.id === follow && m.state === "run") || leader()) : null;
    if (fm) {
      const p = fm.m.position, tag = sect[fm.idx];
      if (tag === "helix" || (fm.idx > helixEnd && fm.idx < helixEnd + 24 && Math.hypot(p.x - helixC.x, p.z - helixC.z) < 3.4)) { // らせんの中（と出口）では外側の斜め上から（外の壁と上の段の間から見下ろす）
        const out = new V(p.x - helixC.x, 0, p.z - helixC.z).normalize();
        wantPos.copy(p).addScaledVector(out, 3.3).addScaledVector(T[fm.idx], -0.8).addScaledVector(Y, 2.3);
        wantLook.copy(p);
        return 0.1;
      }
      // ループとその直後は入口の向きで固定して横から見る（後ろから追うとカメラが筒に入る）
      const inLoop = fm.idx >= loopStart && (fm.idx <= loopEnd || (fm.idx < loopEnd + 20 && p.distanceTo(pts[loopEnd]) < 2.6));
      const j = inLoop ? loopStart - 1 : fm.idx;
      const t = new V(T[j].x, 0, T[j].z).normalize();
      if (inLoop) wantPos.copy(pts[loopStart]).addScaledVector(leftOf(t), 3.2).addScaledVector(t, 0.3).addScaledVector(Y, 0.9);
      else wantPos.copy(p).addScaledVector(t, -2.0).addScaledVector(Y, 1.1);
      if (inLoop) wantLook.copy(p); else wantLook.copy(p).addScaledVector(t, 0.8);
      return 0.12;
    }
    wantLook.copy(bc);
    wantPos.set(bc.x + Math.sin(yaw) * Math.cos(pitch) * dist, bc.y + Math.sin(pitch) * dist, bc.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    return 0.25;
  }

  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.9 ? 62 : 48;
      camera.updateProjectionMatrix();
      dist = (bR / Math.sin(((camera.fov / 2) * Math.PI) / 180)) * (w / h < 1 ? 1.05 : 0.95);
    },
    input(ev) {
      if (ev.type === "keydown") {
        keys.add(ev.code);
        if (ev.code === "Space" || ev.key === " ") addMarble();
        if (ev.code === "KeyR" || ev.key === "r" || ev.key === "R") reset();
        if (ev.code === "KeyC" || ev.key === "c" || ev.key === "C") { mode = mode === "orbit" ? "follow" : "orbit"; follow = -1; }
      } else if (ev.type === "keyup") keys.delete(ev.code);
      else if (ev.type === "pointerdown") {
        drag = { x: ev.x, y: ev.y, yaw, pitch, moved: false };
        ndc.set((ev.x / api.width) * 2 - 1, -(ev.y / api.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects(marbles.filter((m) => m.state !== "queue").map((m) => m.m))[0];
        if (hit) { const mb = marbles.find((m) => m.m === hit.object); follow = mb.id; mode = "follow"; drag = null; }
      } else if (ev.type === "pointermove" && drag) {
        const dx = ev.x - drag.x, dy = ev.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) { mode = "orbit"; yaw = drag.yaw - dx * 0.01; pitch = Math.max(0.05, Math.min(1.35, drag.pitch + dy * 0.008)); lastDrag = clock; }
      } else if (ev.type === "pointerup") drag = null;
    },
    frame(t, dt) {
      const s = Math.min(dt, 100) / 1000;
      if (dt > 0) {
        clock += s;
        step(s);
        screwAngle += s * 4.2;
        if (keys.has("ArrowLeft")) { yaw -= s * 1.2; lastDrag = clock; mode = "orbit"; }
        if (keys.has("ArrowRight")) { yaw += s * 1.2; lastDrag = clock; mode = "orbit"; }
        if (keys.has("ArrowUp")) { pitch = Math.min(1.35, pitch + s); lastDrag = clock; }
        if (keys.has("ArrowDown")) { pitch = Math.max(0.05, pitch - s); lastDrag = clock; }
        if (mode === "orbit" && clock - lastDrag > 3) yaw += s * 0.12; // 触っていなければゆっくり回る
      }
      screw.rotation.y = -screwAngle;
      crown.rotation.y = clock * 0.6;
      for (const mb of marbles) {
        if (mb.state === "run") { mb.m.visible = true; mb.m.position.copy(mb.b.position); mb.m.quaternion.copy(mb.b.quaternion); }
        else if (mb.state === "lift") { mb.m.visible = true; liftPos(mb, mb.m.position); }
        else mb.m.visible = false;
      }
      (scene.userData.chevs || []).forEach((c, i) => (c.material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(clock * 9 - i * 0.9))));
      const k = cameraTarget();
      if (!camInit || dt <= 0 && !camInit) { camPos.copy(wantPos); camLook.copy(wantLook); camInit = true; }
      else if (dt > 0) { const a = 1 - Math.pow(1 - k, dt / 16); camPos.lerp(wantPos, a); camLook.lerp(wantLook, a); }
      else if (drag) { camPos.copy(wantPos); camLook.copy(wantLook); }
      camera.position.copy(camPos);
      camera.lookAt(camLook);
      renderer.render(scene, camera);
      const c = api.ctx;
      c.drawImage(gl, 0, 0, api.width, api.height);
      // 情報
      const running = marbles.filter((m) => m.state === "run").length;
      c.fillStyle = "rgba(8,10,24,0.6)";
      c.fillRect(10, 10, 228, 58);
      c.fillStyle = "#ffd36a"; c.font = "bold 15px sans-serif"; c.textBaseline = "top";
      c.fillText("MARBLE RUN 3D", 20, 16);
      c.fillStyle = "#e8ecff"; c.font = "13px sans-serif";
      c.fillText(`ビー玉 ${marbles.length}/${MAX}  走行 ${running}  ゴール ${laps}`, 20, 36);
      c.fillStyle = "#9aa6d0"; c.font = "11px sans-serif";
      c.fillText(mode === "follow" ? "カメラ: 追従（C で周回）" : "カメラ: 周回（C で追従・玉をクリック）", 20, 53);
      if (dt > 0 && Math.floor(t / 1000) !== Math.floor((t - dt) / 1000)) api.status({ running, laps, lift: marbles.filter((m) => m.state === "lift").length, maxIdx: Math.max(0, ...marbles.map((m) => (m.state === "run" ? m.idx : 0))), N, vmax: +maxSpeed.toFixed(2), mode });
    },
  };
});
