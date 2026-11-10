// render-v1 R-T1-cube の参照の作品。libraries: ["three@0.187.0"]
canvasApp.start((api) => {
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101020);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  const COLORS = { red: 0xff0000, green: 0x00ff00, blue: 0x0080ff };
  let state = "red", angle = 0;
  const mat = new THREE.MeshBasicMaterial({ color: COLORS.red });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), mat);
  scene.add(cube);
  const ray = new THREE.Raycaster();
  function size() {
    renderer.setPixelRatio(api.dpr);
    renderer.setSize(api.width, api.height, false);
    camera.aspect = api.width / api.height;
    camera.updateProjectionMatrix();
  }
  size();
  return {
    resize: size,
    input(ev) {
      if (ev.type === "keydown" && ev.code === "Space") state = state === "red" ? "green" : "red";
      if (ev.type === "pointerdown") {
        ray.setFromCamera(new THREE.Vector2((ev.x / api.width) * 2 - 1, -(ev.y / api.height) * 2 + 1), camera);
        if (ray.intersectObject(cube).length) state = "blue";
      }
    },
    frame(t, dt) {
      angle += dt / 1000;
      cube.rotation.y = angle;
      mat.color.setHex(COLORS[state]);
      renderer.render(scene, camera);
      api.ctx.drawImage(gl, 0, 0, api.width, api.height);
    },
  };
});
