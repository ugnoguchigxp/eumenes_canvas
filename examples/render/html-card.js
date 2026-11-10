// デモ：HTML in canvas（3D）。HTML/CSS で組んだカード 3 面（表と進捗・棒グラフ・組版）を api.decodeSVG で画像にし、Three.js の板のテクスチャとして
// 3D の場面に置く。切り替えは 3 種：フリップ ↔（縦軸で裏返す）、フリップ ↕（横軸で裏返す）、ツイスト（横に 14 本へ割った帯が時間差で回り、ねじれて切り替わる）。
// 手前の 3D ボタン（押し出した角丸の箱、ラベルも HTML）は、指を乗せると浮いて指の方へ傾き光り、押すと沈んでばねで戻る。カードは指の方へ傾く。
// HTML の要素は操作できないので、当たりは Raycaster の uv（カードの面の座標）で作品が判定する（メモ欄をクリックすると入力、キーで文字を受ける）。
// 操作：ボタンをクリック、カードの左右をクリックで前・次へフリップ、キー F（フリップ ↔）・V（フリップ ↕）・T（ツイスト）・D（配色）・←→（前・次）。
// メモ欄を選んでいる間はキーが文字になる（Backspace で消す、Enter で確定）。libraries: ["three@0.187.0"]
canvasApp.start((api) => {
  const CW = 360, CH = 250, SC = 2;             // カードの CSS ピクセル寸法と、画像の倍率
  const W = 3.6, H = 2.5, NS = 14, DEPTH = 0.05; // 3D でのカードの寸法・帯の数・厚み
  const MEMO = { x: 20, y: 196, w: 320, h: 34 }; // 1 面目のメモ欄（CSS ピクセル）
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true });
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 0.25, 8.2);
  camera.lookAt(0, -0.25, 0);
  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x302838, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2.5, 4, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  key.shadow.normalBias = 0.02;
  key.shadow.intensity = 0.5; // 影を薄く（背景の壁が真っ黒にならないように）
  scene.add(key);
  const spot = new THREE.PointLight(0xfff0d0, 6, 9, 1.6); // 指を追う光（カードの艶が動く）
  spot.position.set(0, 0, 3);
  scene.add(spot);

  // 背景：グラデーションの壁と、ゆっくり回る形
  const backC = new OffscreenCanvas(256, 256), backG = backC.getContext("2d");
  const backTex = new THREE.CanvasTexture(backC);
  backTex.colorSpace = THREE.SRGBColorSpace;
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(26, 16), new THREE.MeshLambertMaterial({ map: backTex }));
  backdrop.position.z = -2.2;
  backdrop.receiveShadow = true;
  scene.add(backdrop);
  const floaters = [];
  [[-4.2, 1.6, -1.2, 0], [4.4, -1.4, -1.0, 1], [3.6, 2.0, -1.6, 2], [-3.8, -1.9, -1.4, 1]].forEach(([x, y, z, k]) => {
    const g = [new THREE.TorusGeometry(0.5, 0.18, 12, 32), new THREE.IcosahedronGeometry(0.55, 0), new THREE.OctahedronGeometry(0.5, 0)][k];
    const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80, transparent: true, opacity: 0.55, flatShading: k > 0 }));
    m.position.set(x, y, z);
    m.castShadow = true;
    scene.add(m);
    floaters.push(m);
  });

  // ---- 状態と HTML ----
  let dark = true, page = 0, memo = "", focus = false, switches = 0, hue = 220;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function theme() {
    return dark ? { bg: "linear-gradient(150deg,#1b2140,#2a1745)", fg: "#eef1ff", sub: "#a5aed6", acc: "#ffb648", acc2: "#7ad7ff", row: "rgba(255,255,255,.06)", line: "rgba(255,255,255,.14)" }
      : { bg: "linear-gradient(150deg,#ffffff,#eef3ff)", fg: "#1b2033", sub: "#5a6280", acc: "#2457ff", acc2: "#ff4f7a", row: "#eef2ff", line: "#d6dcf0" };
  }
  function pageHTML(p) {
    const t = theme();
    const head = (title, n) => '<div style="display:flex;justify-content:space-between;align-items:baseline"><div style="font:700 20px sans-serif;color:' + t.acc + '">' + title + '</div><div style="font:12px sans-serif;color:' + t.sub + '">' + (n + 1) + ' / 3</div></div>';
    if (p === 0) {
      const rows = [["温度", (21.5 + switches * 0.1).toFixed(1) + " ℃"], ["湿度", 48 + (switches % 7) + " %"], ["切り替えた回数", switches + " 回"]];
      const pct = Math.min(100, switches * 8);
      return head("HTML <i>in</i> canvas", 0) +
        '<div style="color:' + t.sub + ';margin:2px 0 6px;font-size:13px">CSS の<b>組版</b>・<u>書式</u>・表が、そのまま 3D の面になる</div>' +
        '<table style="border-collapse:collapse;width:100%;font-size:13px">' + rows.map((r, i) => '<tr style="background:' + (i % 2 ? "transparent" : t.row) + '"><td style="padding:3px 6px">' + r[0] + '</td><td style="padding:3px 6px;text-align:right;font-family:monospace">' + r[1] + '</td></tr>').join("") + '</table>' +
        '<div style="height:7px;border-radius:4px;background:' + t.line + ';margin:8px 0"><div style="height:7px;border-radius:4px;width:' + pct + '%;background:linear-gradient(90deg,' + t.acc + ',' + t.acc2 + ')"></div></div>' +
        '<div style="position:absolute;left:' + MEMO.x + 'px;top:' + MEMO.y + 'px;width:' + (MEMO.w - 18) + 'px;height:' + (MEMO.h - 2) + 'px;padding:0 8px;line-height:' + (MEMO.h - 2) + 'px;border-radius:9px;border:' + (focus ? 2 : 1) + 'px solid ' + (focus ? t.acc : t.line) + ';color:' + (memo ? t.fg : t.sub) + ';font-size:14px;overflow:hidden;white-space:nowrap">' +
        (memo ? esc(memo) : "メモ：ここをクリックして入力") + (focus ? '<span style="color:' + t.acc + '">▏</span>' : "") + '</div>';
    }
    if (p === 1) {
      const vals = [42, 68, 55, 90, 73, 60].map((v, i) => Math.max(8, Math.min(100, v + ((switches * (i + 3)) % 17) - 8)));
      const names = ["月", "火", "水", "木", "金", "土"];
      return head("棒グラフ（CSS だけ）", 1) +
        '<div style="display:flex;align-items:flex-end;gap:12px;height:150px;margin:12px 4px 4px;padding:0 6px;border-bottom:2px solid ' + t.line + '">' +
        vals.map((v, i) => '<div style="flex:1;text-align:center;font:11px monospace;color:' + t.sub + '">' + v + '<div style="height:' + v * 1.25 + 'px;border-radius:6px 6px 2px 2px;margin-top:3px;background:linear-gradient(180deg,' + (i === 3 ? t.acc : t.acc2) + ',' + (dark ? "rgba(255,255,255,.15)" : "rgba(0,0,0,.08)") + ')"></div></div>').join("") + '</div>' +
        '<div style="display:flex;gap:12px;padding:0 10px;font-size:12px;color:' + t.sub + '">' + names.map((n) => '<div style="flex:1;text-align:center">' + n + '</div>').join("") + '</div>' +
        '<div style="margin-top:8px;font-size:12px;color:' + t.sub + '">最大は <b style="color:' + t.acc + '">木曜</b>。値は切り替えるたびに少し変わる。</div>';
    }
    return head("組版", 2) +
      '<div style="margin-top:8px;font:italic 600 22px serif;line-height:1.35;color:' + t.fg + ';border-left:4px solid ' + t.acc + ';padding-left:12px">“The card is HTML,<br/>the turn is WebGL.”</div>' +
      '<ul style="margin:12px 0 0;padding-left:20px;font-size:13px;line-height:1.7;color:' + t.fg + '">' +
      '<li><b>foreignObject</b> の HTML を <code style="background:' + t.row + ';padding:1px 4px;border-radius:4px">api.decodeSVG</code> で画像に</li>' +
      '<li>画像を <span style="color:' + t.acc2 + '">CanvasTexture</span> にして帯ごとに貼る</li>' +
      '<li><s>DOM の操作</s> → 当たりは <u>uv 座標</u>で判定</li></ul>';
  }
  function cardSVG(p) {
    const t = theme();
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + CW * SC + '" height="' + CH * SC + '" viewBox="0 0 ' + CW + " " + CH + '"><foreignObject width="' + CW + '" height="' + CH + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;box-sizing:border-box;width:' + CW + 'px;height:' + CH + 'px;padding:14px 20px;border-radius:18px;background:' + t.bg + ';color:' + t.fg + ';font:14px sans-serif;box-shadow:0 0 0 2px ' + t.acc + ' inset">' +
      pageHTML(p) + '</div></foreignObject></svg>';
  }
  // 画像の置き場：ページごとに版を持ち、内容が変わった版だけ作り直す（同時に 1 件ずつ、まとめて）
  const cache = [null, null, null], ver = [0, 0, 0], want = [1, 1, 1];
  let decoding = -1;
  function invalidate(p) { want[p]++; pump(); }
  function invalidateAll() { want[0]++; want[1]++; want[2]++; pump(); }
  function pump() {
    if (decoding >= 0) return;
    // 今のページ → 次 → 前 の順に
    const order = [page, (page + 1) % 3, (page + 2) % 3];
    const p = order.find((k) => ver[k] !== want[k]);
    if (p === undefined) return;
    decoding = p;
    const v = want[p];
    api.decodeSVG(cardSVG(p)).then((b) => {
      decoding = -1;
      if (cache[p]) cache[p].close();
      cache[p] = b; ver[p] = v;
      if (p === page && !anim && !queued) paintFace(front, b); // 切り替え待ちのときは、切り替えで見せる
      pump();
      maybeStart();
    }, () => { decoding = -1; }); // 上限を超えたときは次の呼び出しでやり直す
  }

  // ---- カード：帯 NS 本。表（front）と裏（back）の 2 枚の面を全帯で共有する ----
  function face() {
    const c = new OffscreenCanvas(CW * SC, CH * SC);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { c, g: c.getContext("2d"), tex, mat: new THREE.MeshPhongMaterial({ map: tex, color: 0xd8d8d8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.42, shininess: 60, specular: 0x555555, transparent: true }) };
  }
  const front = face(), back = face();
  function paintFace(f, bmp) {
    f.g.clearRect(0, 0, f.c.width, f.c.height);
    f.g.drawImage(bmp, 0, 0, f.c.width, f.c.height);
    f.tex.needsUpdate = true;
  }
  const edgeMat = new THREE.MeshPhongMaterial({ color: 0xffd28a, emissive: 0x302010, shininess: 90 });
  const card = new THREE.Group();   // 指の方へ傾く・漂う
  const flipper = new THREE.Group(); // フリップで回る
  card.add(flipper);
  scene.add(card);
  card.position.y = 0.35;
  const strips = [];
  for (let i = 0; i < NS; i++) {
    const h = H / NS, cy = -H / 2 + (i + 0.5) * h;
    const geo = new THREE.BoxGeometry(W, h * 1.002, DEPTH);
    const m = new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, front.mat, back.mat]);
    m.position.y = cy;
    m.castShadow = true;
    flipper.add(m);
    strips.push({ m, cy, geo });
  }
  // 面の uv をカード全体の座標にする。裏は回る軸に合わせて向きを変える（axis: "y" は左右、"x" は上下が反転）
  function setUV(axis) {
    for (const s of strips) {
      const pos = s.geo.attributes.position, uv = s.geo.attributes.uv;
      for (const gr of s.geo.groups) {
        if (gr.materialIndex < 4) continue;
        for (let k = gr.start; k < gr.start + gr.count; k++) {
          const vi = s.geo.index.getX(k), x = pos.getX(vi), y = pos.getY(vi) + s.cy;
          let u = x / W + 0.5, v = y / H + 0.5;
          if (gr.materialIndex === 5) { if (axis === "y") u = 1 - u; else v = 1 - v; }
          uv.setXY(vi, u, v);
        }
      }
      uv.needsUpdate = true;
    }
  }
  setUV("y");

  // ---- 切り替え ----
  let anim = null, queued = null;
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  function request(kind, dir, same = false) {
    queued = { kind, dir, same };
    if (!anim) maybeStart();
  }
  function maybeStart() {
    if (anim || !queued) return;
    const { kind, dir, same } = queued;
    const next = same ? page : (page + (dir < 0 ? 2 : 1)) % 3;
    if (!cache[next] || ver[next] !== want[next]) { pump(); return; } // 画像が届いたら始める
    queued = null;
    setUV(kind === "flipX" ? "x" : "y");
    paintFace(back, cache[next]);
    anim = { kind, dir: dir < 0 ? -1 : 1, t: 0, dur: kind === "twist" ? 1.6 : 0.95, next };
    focus = false;
  }
  function finish() {
    page = anim.next;
    paintFace(front, cache[page]);
    flipper.rotation.set(0, 0, 0);
    flipper.position.z = 0;
    strips.forEach((s) => { s.m.rotation.set(0, 0, 0); s.m.position.z = 0; });
    setUV("y");
    anim = null;
    switches++;
    invalidateAll(); // 回数・グラフの値が変わる
    maybeStart();
  }
  function applyAnim() {
    if (!anim) return;
    const k = Math.min(1, anim.t / anim.dur);
    if (anim.kind === "twist") {
      const span = 0.6; // 各帯が回る時間（全体に対する割合）。残りを上から下への時間差に使う
      strips.forEach((s, i) => {
        const d = ((NS - 1 - i) / (NS - 1)) * (1 - span), kk = ease(Math.max(0, Math.min(1, (k - d) / span)));
        s.m.rotation.y = anim.dir * Math.PI * kk;
        s.m.position.z = Math.sin(Math.PI * kk) * 0.35;
      });
      flipper.position.z = Math.sin(Math.PI * k) * 0.3;
    } else {
      const kk = ease(k);
      if (anim.kind === "flipX") flipper.rotation.x = -anim.dir * Math.PI * kk;
      else flipper.rotation.y = anim.dir * Math.PI * kk;
      flipper.position.z = Math.sin(Math.PI * kk) * 0.6;
    }
  }

  // ---- 3D ボタン ----
  const BTN = [
    { id: "flipY", label: "フリップ ↔", color: 0xff5a7a },
    { id: "flipX", label: "フリップ ↕", color: 0xffa83a },
    { id: "twist", label: "ツイスト", color: 0x3ad0ff },
    { id: "theme", label: "配色", color: 0x9a7bff },
  ];
  const BW = 1.25, BH = 0.5, BD = 0.22, LW = 200, LH = 80;
  {
    const sh = new THREE.Shape(), r = 0.14, x0 = -BW / 2, y0 = -BH / 2;
    sh.moveTo(x0 + r, y0); sh.lineTo(x0 + BW - r, y0); sh.quadraticCurveTo(x0 + BW, y0, x0 + BW, y0 + r); sh.lineTo(x0 + BW, y0 + BH - r);
    sh.quadraticCurveTo(x0 + BW, y0 + BH, x0 + BW - r, y0 + BH); sh.lineTo(x0 + r, y0 + BH); sh.quadraticCurveTo(x0, y0 + BH, x0, y0 + BH - r);
    sh.lineTo(x0, y0 + r); sh.quadraticCurveTo(x0, y0, x0 + r, y0);
    var btnGeo = new THREE.ExtrudeGeometry(sh, { depth: BD, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 3, curveSegments: 6 });
  }
  const buttons = BTN.map((b, i) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(btnGeo, new THREE.MeshPhongMaterial({ color: b.color, emissive: 0x000000, shininess: 110, specular: 0xffffff }));
    body.castShadow = true;
    const c = new OffscreenCanvas(LW * 2, LH * 2), tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(BW * 0.92, BH * 0.84), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    label.position.z = BD + 0.056;
    g.add(body, label);
    g.position.set((i - 1.5) * 1.5, -1.75, 0.6);
    scene.add(g);
    return { ...b, g, body, c, tex, hover: 0, z: 0, vz: 0, tx: 0, ty: 0, glow: 0 };
  });
  // ラベルも HTML：1 枚の SVG に 4 つ並べて復号し、各ボタンの面へ切り分ける
  function labelsSVG() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + LW * 2 + '" height="' + LH * 2 * BTN.length + '" viewBox="0 0 ' + LW + " " + LH * BTN.length + '"><foreignObject width="' + LW + '" height="' + LH * BTN.length + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + LW + 'px;font:700 38px sans-serif;color:#fff">' +
      BTN.map((b) => '<div style="height:' + LH + 'px;line-height:' + LH + 'px;text-align:center;text-shadow:0 2px 4px rgba(0,0,0,.45)">' + (b.id === "theme" ? (dark ? "☀ ライト" : "☾ ダーク") : b.label) + '</div>').join("") +
      '</div></foreignObject></svg>';
  }
  let labelsPending = false, labelsDirty = true;
  function makeLabels() {
    if (labelsPending || !labelsDirty) return;
    labelsPending = true; labelsDirty = false;
    api.decodeSVG(labelsSVG()).then((bmp) => {
      labelsPending = false;
      buttons.forEach((b, i) => { const g = b.c.getContext("2d"); g.clearRect(0, 0, b.c.width, b.c.height); g.drawImage(bmp, 0, i * LH * 2, LW * 2, LH * 2, 0, 0, b.c.width, b.c.height); b.tex.needsUpdate = true; });
      bmp.close();
      makeLabels();
    }, () => { labelsPending = false; labelsDirty = true; });
  }
  makeLabels();
  pump();

  function paintBackdrop() {
    const g = backG, gr = g.createLinearGradient(0, 0, 256, 256);
    gr.addColorStop(0, `hsl(${hue}, 60%, ${dark ? 30 : 80}%)`);
    gr.addColorStop(1, `hsl(${(hue + 70) % 360}, 60%, ${dark ? 16 : 68}%)`);
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const rg = g.createRadialGradient(128, 110, 10, 128, 110, 150);
    rg.addColorStop(0, dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.5)"); rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    backTex.needsUpdate = true;
  }
  paintBackdrop();

  function act(id) {
    if (id === "flipY") request("flipY", 1);
    else if (id === "flipX") request("flipX", 1);
    else if (id === "twist") request("twist", 1);
    else if (id === "theme") { dark = !dark; labelsDirty = true; makeLabels(); invalidateAll(); paintBackdrop(); request("twist", 1, true); } // 同じ面を新しい配色にしてツイストで見せる
  }

  // ---- 入力 ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let pointer = null, clock = 0, pressed = null;
  function pick(x, y) {
    ndc.set((x / api.width) * 2 - 1, -(y / api.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([...buttons.map((b) => b.body), ...strips.map((s) => s.m)], false);
    if (!hits.length) return null;
    const h = hits[0], b = buttons.find((bb) => bb.body === h.object);
    if (b) return { button: b, point: h.point };
    return { card: true, uv: h.uv, point: h.point };
  }
  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // 縦長の画面ではカードとボタンが入るように引く
      camera.position.z = w / h < 1 ? 8.2 / Math.max(0.55, w / h) : 8.2;
      camera.updateProjectionMatrix();
    },
    input(ev) {
      if (ev.type === "pointermove" || ev.type === "pointerdown") {
        pointer = { x: ev.x, y: ev.y, hit: pick(ev.x, ev.y) };
      }
      if (ev.type === "pointerdown") {
        const hit = pointer.hit;
        if (hit && hit.button) { pressed = hit.button; hit.button.vz = -2.6; hit.button.glow = 1; act(hit.button.id); return; }
        if (hit && hit.card && !anim) {
          const cx = hit.uv.x * CW, cy = (1 - hit.uv.y) * CH;
          const inMemo = page === 0 && cx >= MEMO.x && cx < MEMO.x + MEMO.w && cy >= MEMO.y && cy < MEMO.y + MEMO.h;
          if (inMemo !== focus) { focus = inMemo; invalidate(0); }
          if (!inMemo) request("flipY", hit.uv.x < 0.5 ? -1 : 1);
          return;
        }
        if (focus) { focus = false; invalidate(0); }
      } else if (ev.type === "pointerup") pressed = null;
      else if (ev.type === "keydown") {
        const k = ev.key, c = ev.code;
        if (focus) {
          if (k === "Backspace") memo = memo.slice(0, -1);
          else if (k === "Enter") focus = false;
          else if (k && k.length === 1 && memo.length < 32) memo += k;
          else return;
          invalidate(0);
          return;
        }
        if (c === "KeyF" || k === "f" || k === "F") request("flipY", 1);
        else if (c === "KeyV" || k === "v" || k === "V") request("flipX", 1);
        else if (c === "KeyT" || k === "t" || k === "T") request("twist", 1);
        else if (c === "KeyD" || k === "d" || k === "D") act("theme");
        else if (c === "ArrowRight") request("flipY", 1);
        else if (c === "ArrowLeft") request("flipY", -1);
        else if (c === "Space" || k === " ") request("twist", 1);
      }
    },
    frame(t, dt) {
      const s = Math.min(dt, 100) / 1000;
      if (dt > 0) {
        clock += s;
        if (anim) { anim.t += s; if (anim.t >= anim.dur) finish(); }
        // ボタン：ばね（沈み z と速度 vz）、浮き（hover）、傾き、光
        for (const b of buttons) {
          const over = pointer && pointer.hit && pointer.hit.button === b;
          b.hover += ((over ? 1 : 0) - b.hover) * Math.min(1, s * 12);
          const target = pressed === b ? -0.12 : 0;
          b.vz += ((target - b.z) * 260 - b.vz * 14) * s;
          b.z += b.vz * s;
          let tx = 0, ty = 0;
          if (over) { const lp = b.g.worldToLocal(pointer.hit.point.clone()); ty = (lp.x / (BW / 2)) * 0.35; tx = -(lp.y / (BH / 2)) * 0.35; }
          b.tx += (tx - b.tx) * Math.min(1, s * 10); b.ty += (ty - b.ty) * Math.min(1, s * 10);
          b.glow = Math.max(0, b.glow - s * 2.2);
        }
        for (const [i, f] of floaters.entries()) { f.rotation.x += s * (0.2 + i * 0.07); f.rotation.y += s * 0.3; f.position.y += Math.sin(clock * 0.8 + i) * s * 0.15; }
      }
      applyAnim();
      // カードの傾き（指の方へ）と漂い
      let rx = Math.sin(clock * 0.9) * 0.04, ry = Math.sin(clock * 0.6) * 0.07;
      if (pointer) { rx += -((pointer.y / api.height) - 0.4) * 0.35; ry += ((pointer.x / api.width) - 0.5) * 0.5; }
      card.rotation.x += (rx - card.rotation.x) * (dt > 0 ? Math.min(1, s * 6) : 0);
      card.rotation.y += (ry - card.rotation.y) * (dt > 0 ? Math.min(1, s * 6) : 0);
      card.position.y = 0.35 + Math.sin(clock * 1.1) * 0.05;
      if (pointer) { spot.position.x += ((pointer.x / api.width - 0.5) * 7 - spot.position.x) * Math.min(1, s * 8); spot.position.y += (-(pointer.y / api.height - 0.5) * 5 - spot.position.y) * Math.min(1, s * 8); }
      for (const b of buttons) {
        b.g.position.z = 0.6 + b.hover * 0.22 + b.z;
        b.g.rotation.set(b.tx * b.hover, b.ty * b.hover, 0);
        const e = 0.18 * b.hover + 0.55 * b.glow;
        b.body.material.emissive.setRGB(e, e, e);
        b.g.scale.setScalar(1 + b.hover * 0.06);
      }
      edgeMat.emissive.setHex(dark ? 0x302010 : 0x101830);
      renderer.render(scene, camera);
      const c = api.ctx;
      c.drawImage(gl, 0, 0, api.width, api.height);
      c.fillStyle = dark ? "rgba(255,255,255,0.75)" : "rgba(20,24,40,0.75)";
      c.font = "12px sans-serif"; c.textAlign = "center"; c.textBaseline = "bottom";
      c.fillText(anim ? (anim.kind === "twist" ? "ツイスト中…" : "フリップ中…") : focus ? "メモに入力中（Enter で確定）" : "ボタン / カードの左右をクリック ・ F V T D ← →", api.width / 2, api.height - 6);
      if (!cache[page]) { c.fillStyle = "#fff"; c.fillText("HTML を画像にしています…", api.width / 2, api.height / 2); }
      if (dt > 0 && Math.floor(t / 500) !== Math.floor((t - dt) / 500)) api.status({ page, switches, dark, memo, focus, anim: anim ? anim.kind : null, cached: cache.map(Boolean) });
    },
  };
});
