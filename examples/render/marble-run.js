// デモ：marble run（物理）。ジグザグの坂を複数のビー玉が転がり落ち、下の箱に集まる。
// Space で 1 個足す、R で最初から、←→ でカメラを回す。libraries: ["three@0.187.0", "cannon-es@0.20.0"]
canvasApp.start((api) => {
  const MAX = 12, R = 0.25, SPAWN_MS = 1200;
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161c);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xc0d0ff, 0x302820, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 12, 8);
  sun.castShadow = true;
  sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -2;
  scene.add(sun);

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  const track = new CANNON.Material("track"), glass = new CANNON.Material("glass"), marbleMat = new CANNON.Material("marble");
  world.addContactMaterial(new CANNON.ContactMaterial(track, marbleMat, { friction: 0.04, restitution: 0.35 }));
  world.addContactMaterial(new CANNON.ContactMaterial(glass, marbleMat, { friction: 0, restitution: 0.1 }));
  world.addContactMaterial(new CANNON.ContactMaterial(marbleMat, marbleMat, { friction: 0.02, restitution: 0.6 }));

  // 静的な部品：位置・大きさ（半分）・z 軸回りの角度・色・見せるか
  function addStatic(x, y, z, hx, hy, hz, angle, color, mat, visible = true) {
    const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)) });
    b.position.set(x, y, z);
    b.quaternion.setFromEuler(0, 0, angle);
    world.addBody(b);
    if (visible) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
      m.position.set(x, y, z);
      m.rotation.z = angle;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  }
  const A = (18 * Math.PI) / 180;
  const rampColors = [0xe0603a, 0xe0a03a, 0x4ab070, 0x3a8ae0];
  // 坂は高い側の端が壁に付き、低い側の端と反対の壁の間に落ち口（約 1.3）が開く
  // 坂どうしの縦の間隔は、上の坂の低い端と下の坂の間をビー玉（直径 0.5）が通れるだけ空ける
  const HL = 2.6, HX = HL * Math.cos(A);
  [9.5, 7.5, 5.5, 3.5].forEach((y, i) => addStatic(i % 2 ? 3.6 - HX : -3.6 + HX, y, 0, HL, 0.08, 0.6, i % 2 ? A : -A, rampColors[i], track));
  addStatic(-3.7, 6, 0, 0.1, 6, 0.6, 0, 0x8a8f9a, track);
  addStatic(3.7, 6, 0, 0.1, 6, 0.6, 0, 0x8a8f9a, track);
  addStatic(0, 12.1, 0, 3.8, 0.1, 0.6, 0, 0x8a8f9a, track, false); // 天井（はじかれたビー玉が外に出ないように）
  addStatic(0, -0.1, 0, 3.8, 0.1, 0.6, 0, 0x5a5f6a, track); // 箱の底
  addStatic(0, 6, 0.8, 4, 6.5, 0.2, 0, 0, glass, false); // 手前と奥のガラス（見せない）
  addStatic(0, 6, -0.8, 4, 6.5, 0.2, 0, 0, glass, false);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 13), new THREE.MeshStandardMaterial({ color: 0x232733 }));
  back.position.set(0, 6, -0.8);
  back.receiveShadow = true;
  scene.add(back);
  const binMark = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.9, 0.05), new THREE.MeshBasicMaterial({ color: 0x2f6f3f, transparent: true, opacity: 0.35 }));
  binMark.position.set(0, 0.45, 0.66);
  scene.add(binMark);

  const palette = [0xffffff, 0xff4d6d, 0x4dd2ff, 0xffd34d, 0x9dff4d, 0xc77dff];
  const sphereGeo = new THREE.SphereGeometry(R, 24, 16);
  let marbles = [], spawnClock = 0, spawned = 0;
  function spawn() {
    if (spawned >= MAX) return;
    // 出口がふさがっているときは出さない（重なって生まれると強くはじかれる）
    if (marbles.some(({ b }) => b.position.x < -2.2 && b.position.y > 9.8)) return;
    const b = new CANNON.Body({ mass: 0.05, material: marbleMat, shape: new CANNON.Sphere(R), linearDamping: 0.01, angularDamping: 0.01 });
    b.position.set(-3.2 + api.random() * 0.4, 10.9, (api.random() - 0.5) * 0.3);
    world.addBody(b);
    const m = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: palette[spawned % palette.length], roughness: 0.15, metalness: 0.1 }));
    m.castShadow = true;
    scene.add(m);
    marbles.push({ b, m });
    spawned++;
  }
  function reset() {
    for (const { b, m } of marbles) { world.removeBody(b); scene.remove(m); m.material.dispose(); }
    marbles = []; spawned = 0; spawnClock = 0;
    spawn();
  }
  reset();

  let yaw = 0;
  const keys = new Set();
  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    input(ev) {
      if (ev.type === "keydown") {
        keys.add(ev.code);
        if (ev.code === "Space" || ev.key === " ") spawn();
        if (ev.code === "KeyR" || ev.key === "r" || ev.key === "R") reset();
      } else if (ev.type === "keyup") keys.delete(ev.code);
      else if (ev.type === "pointerdown") spawn();
    },
    frame(t, dt) {
      if (dt > 0) {
        const s = dt / 1000;
        spawnClock += dt;
        while (spawnClock >= SPAWN_MS) { spawnClock -= SPAWN_MS; spawn(); }
        world.step(1 / 120, s, 10);
        if (keys.has("ArrowLeft")) yaw = Math.max(-0.8, yaw - s);
        if (keys.has("ArrowRight")) yaw = Math.min(0.8, yaw + s);
        // 外に飛び出したものは戻す（すり抜けの保険）
        for (const { b } of marbles) if (b.position.y < -3 || Math.abs(b.position.x) > 5) { b.position.set(-3.0, 10.9, 0); b.velocity.setZero(); }
      }
      for (const { b, m } of marbles) { m.position.copy(b.position); m.quaternion.copy(b.quaternion); }
      const aspect = api.width / api.height;
      const d = aspect < 0.9 ? 24 : 17;
      camera.position.set(Math.sin(yaw) * d, 6, Math.cos(yaw) * d);
      camera.lookAt(0, 5.6, 0);
      renderer.render(scene, camera);
      const c = api.ctx;
      c.drawImage(gl, 0, 0, api.width, api.height);
      const inBin = marbles.filter(({ b }) => b.position.y < 0.9).length;
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.fillRect(8, 8, 220, 30);
      c.fillStyle = "#ffffff";
      c.font = "16px sans-serif";
      c.textBaseline = "middle";
      c.fillText(`ビー玉 ${marbles.length}/${MAX}　箱の中 ${inBin}`, 16, 23);
      if (dt > 0 && Math.floor(t / 1000) !== Math.floor((t - dt) / 1000)) api.status({ marbles: marbles.length, inBin });
    },
  };
});
