// デモ：物理なしの Three.js の場面。照明・影・カメラの回り込み（ドラッグ・←→↑↓）、クリックした物体の色替え（Raycaster）、
// HTML の名札（api.decodeSVG → CanvasTexture）。libraries: ["three@0.187.0"]
canvasApp.start((api) => {
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);
  scene.fog = new THREE.Fog(0x0b1020, 12, 30);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  const hemi = new THREE.HemisphereLight(0x8090ff, 0x202010, 0.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 8, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x223044, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(new THREE.GridHelper(30, 30, 0x4060a0, 0x2a3a5a));

  const palette = [0xff5040, 0x40d080, 0x4090ff, 0xffc030, 0xd060ff];
  const shapes = [];
  const geos = [new THREE.TorusKnotGeometry(0.7, 0.25, 128, 16), new THREE.IcosahedronGeometry(0.9, 0), new THREE.BoxGeometry(1.3, 1.3, 1.3)];
  geos.forEach((g, i) => {
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: palette[i], roughness: 0.35, metalness: 0.2 }));
    m.position.set((i - 1) * 3, 1.4, 0);
    m.castShadow = true;
    m.userData.colorIndex = i;
    scene.add(m);
    shapes.push(m);
  });

  // HTML の名札：組版した HTML を画像にし、2D の面に写してテクスチャにする
  const labelCanvas = new OffscreenCanvas(512, 128);
  const labelCtx = labelCanvas.getContext("2d");
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: labelTex, transparent: true }));
  label.position.set(0, 3.4, 0);
  scene.add(label);
  let clicks = 0;
  function renderLabel() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="128"><foreignObject width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:512px;height:128px;padding:14px 22px;border-radius:24px;' +
      'background:linear-gradient(90deg,#1d3b8f,#6a2a9a);color:#fff;font:600 34px sans-serif">Three.js <span style="color:#ffd84a">r' + THREE.REVISION + '</span>' +
      '<div style="font:400 22px sans-serif;opacity:.85">クリックした回数: <b>' + clicks + '</b></div></div></foreignObject></svg>';
    api.decodeSVG(svg).then((bmp) => {
      labelCtx.clearRect(0, 0, 512, 128);
      labelCtx.drawImage(bmp, 0, 0);
      bmp.close();
      labelTex.needsUpdate = true;
    }, (e) => api.status({ labelError: String(e) }));
  }
  renderLabel();

  let yaw = 0.6, pitch = 0.45, dist = 11, spin = 0;
  const keys = new Set();
  let drag = null;
  function placeCamera() {
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + 0.5, Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(0, 1.2, 0);
    label.quaternion.copy(camera.quaternion);
  }
  const ray = new THREE.Raycaster();
  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    input(ev) {
      if (ev.type === "keydown") keys.add(ev.code || ev.key);
      else if (ev.type === "keyup") keys.delete(ev.code || ev.key);
      else if (ev.type === "pointerdown") {
        drag = { x: ev.x, y: ev.y, moved: false };
      } else if (ev.type === "pointermove" && drag) {
        const dx = ev.x - drag.x, dy = ev.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        yaw -= dx * 0.01;
        pitch = Math.min(1.3, Math.max(0.05, pitch + dy * 0.01));
        drag.x = ev.x; drag.y = ev.y;
      } else if (ev.type === "pointerup") {
        if (drag && !drag.moved) {
          ray.setFromCamera(new THREE.Vector2((ev.x / api.width) * 2 - 1, -(ev.y / api.height) * 2 + 1), camera);
          const hit = ray.intersectObjects(shapes)[0];
          if (hit) {
            const m = hit.object;
            m.userData.colorIndex = (m.userData.colorIndex + 1) % palette.length;
            m.material.color.setHex(palette[m.userData.colorIndex]);
            clicks++;
            renderLabel();
          }
        }
        drag = null;
      }
    },
    frame(t, dt) {
      if (dt > 0) {
        const s = dt / 1000;
        spin += s;
        if (keys.has("ArrowLeft")) yaw -= 1.5 * s;
        if (keys.has("ArrowRight")) yaw += 1.5 * s;
        if (keys.has("ArrowUp")) pitch = Math.min(1.3, pitch + 1.2 * s);
        if (keys.has("ArrowDown")) pitch = Math.max(0.05, pitch - 1.2 * s);
      }
      shapes.forEach((m, i) => { m.rotation.set(spin * (0.4 + i * 0.2), spin * (0.7 - i * 0.1), 0); m.position.y = 1.4 + Math.sin(spin * 1.5 + i) * 0.25; });
      placeCamera();
      renderer.render(scene, camera);
      api.ctx.drawImage(gl, 0, 0, api.width, api.height);
    },
  };
});
