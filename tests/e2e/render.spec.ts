// 描画方式の拡張（design.md §7）の最小化した試験。デモ（examples/render/）で成功を見分けた画素・振る舞いだけを残した小さな作品で確かめる。
// WebGL は Chromium だけ（WebKit 26.0 の Linux では Worker の WebGL が作れず、実行時エラーになることを確かめる）。
import { test, expect, type Page } from "@playwright/test";
import { openHarness, start, advance, events, waitStatus, canaryHits, CANARY } from "./support/harness";
import { shot, find, hex, diffRatio, px, near } from "./support/pixels";

const THREE_ID = "three@0.187.0", CANNON_ID = "cannon-es@0.20.0";
const uid = () => Math.random().toString(36).slice(2, 10);
const frame = (page: Page) => page.locator("#frame");
const errorsOf = async (page: Page) => (await events(page)).filter((e) => e.type === "error" || e.type === "violation").map((e) => e.message);
async function key(page: Page, k: string, holdMs: number) {
  await page.evaluate(() => (window as any).harness.focus());
  await page.keyboard.down(k);
  await advance(page, holdMs);
  await page.keyboard.up(k);
  await advance(page, 0);
}

// 青い背景に、照明に左右されない赤い板（回る）。Space で板が緑になる。drawImage を省くと写らない。
const webglQuad = (copy = true) => `canvasApp.start((api) => {
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl });
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0000ff);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.z = 5;
  const mat = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat); scene.add(quad);
  let a = 0;
  return {
    resize(w, h, dpr) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    input(ev) { if (ev.type === "keydown" && (ev.code === "Space" || ev.key === " ")) mat.color.setHex(0x00ff00); },
    frame(t, dt) { if (dt > 0) a += dt / 1000; quad.rotation.z = a; renderer.render(scene, camera); ${copy ? "api.ctx.drawImage(gl, 0, 0, api.width, api.height);" : ""} },
  };
});`;

test.describe("Three.js（WebGL）", () => {
  test("同梱の Three.js で描いた WebGL の画素が作品の面に写り、時間とキーで変わる", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "WebGL は Chromium だけで確かめる");
    await openHarness(page);
    expect((await start(page, webglQuad(), { libraries: [THREE_ID] })).type).toBe("ready");
    const s0 = await shot(frame(page));
    const red = find(s0, hex("#ff0000"), 30), blue = find(s0, hex("#0000ff"), 30);
    expect(red.count).toBeGreaterThan(5000); // 板（中央）
    expect(blue.count).toBeGreaterThan(50000); // 背景
    expect(Math.abs(red.cx - s0.width / 2)).toBeLessThan(6);
    expect(near(px(s0, 4, 4), hex("#0000ff"), 30)).toBe(true);
    await advance(page, 400);
    const s1 = await shot(frame(page));
    expect(diffRatio(s0, s1)).toBeGreaterThan(0.005); // 回った
    await key(page, "Space", 50);
    const s2 = await shot(frame(page));
    expect(find(s2, hex("#00ff00"), 30).count).toBeGreaterThan(5000);
    expect(await errorsOf(page)).toEqual([]);
  });

  test("作品の面へ写し忘れた WebGL は表示されず、観測では単色になる（無言の成功にはならない）", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "WebGL は Chromium だけで確かめる");
    await openHarness(page);
    expect((await start(page, webglQuad(false), { libraries: [THREE_ID] })).type).toBe("ready");
    await advance(page, 200);
    const s = await shot(frame(page));
    expect(find(s, hex("#ff0000"), 30).count).toBe(0);
    expect(find(s, hex("#0000ff"), 30).count).toBe(0);
  });

  test("WebKit では WebGL の文脈が作れず、実行時エラーとして報告される", async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "WebKit の挙動の記録");
    await openHarness(page);
    const r = await start(page, webglQuad(), { libraries: [THREE_ID] });
    expect(r.type).toBe("error");
    expect((await errorsOf(page)).join(" ")).toContain("WebGL");
  });

  // ブラックホールのデモから：全画面のシェーダー。中心は暗い影、その外に明るい輪、時間で模様が回る。
  test("ShaderMaterial の全画面シェーダー：中心の影・外側の輪・時間で変わる模様が画素に出る", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "WebGL は Chromium だけで確かめる");
    const entry = `canvasApp.start((api) => {
      const gl = new OffscreenCanvas(1, 1);
      const renderer = new THREE.WebGLRenderer({ canvas: gl });
      const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const u = { uT: { value: 0 }, uA: { value: 1 } };
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: u,
        vertexShader: "varying vec2 v; void main(){ v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: "varying vec2 v; uniform float uT, uA; void main(){ vec2 p = (v - 0.5) * vec2(uA, 1.0); float r = length(p); float a = atan(p.y, p.x);" +
          "float ring = smoothstep(0.17, 0.2, r) * smoothstep(0.32, 0.26, r) * (0.75 + 0.25 * sin(a * 6.0 + uT * 3.0));" +
          "gl_FragColor = vec4(vec3(1.0, 0.7, 0.3) * ring + vec3(0.02, 0.02, 0.06) * step(0.32, r), 1.0); }" })));
      return {
        resize(w, h, dpr) { renderer.setPixelRatio(dpr * 0.5); renderer.setSize(w, h, false); u.uA.value = w / h; },
        frame(t, dt) { if (dt > 0) u.uT.value += dt / 1000; renderer.render(scene, camera); api.ctx.drawImage(gl, 0, 0, api.width, api.height); },
      };
    });`;
    await openHarness(page);
    expect((await start(page, entry, { libraries: [THREE_ID] })).type).toBe("ready");
    const s0 = await shot(frame(page));
    const W = s0.width, H = s0.height;
    const lum = (c: number[]) => (c[0] + c[1] + c[2]) / 3;
    expect(lum(px(s0, W / 2, H / 2))).toBeLessThan(15); // 影
    const ringR = 0.23 * H;
    const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => lum(px(s0, W / 2 + Math.cos((k * Math.PI) / 4) * ringR, H / 2 + Math.sin((k * Math.PI) / 4) * ringR)));
    expect(Math.min(...ring)).toBeGreaterThan(60); // 輪は全周で明るい
    expect(lum(px(s0, 6, 6))).toBeLessThan(30);
    await advance(page, 300);
    expect(diffRatio(s0, await shot(frame(page)), 8)).toBeGreaterThan(0.01);
    expect(await errorsOf(page)).toEqual([]);
  });
});

test.describe("物理（cannon-es）", () => {
  // marble run のデモから：球が重力で落ち、床で止まる。dt=0（入力）では進まない。描画は 2D なので両ブラウザで確かめる。
  const drop = `canvasApp.start((api) => {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() }); floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(floor);
    const ball = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5), position: new CANNON.Vec3(0, 6, 0), linearDamping: 0.3 }); world.addBody(ball);
    world.defaultContactMaterial.restitution = 0.2;
    return {
      frame(t, dt) {
        if (dt > 0) world.step(1 / 60, dt / 1000, 5);
        const c = api.ctx, k = 40, gy = api.height - 20;
        c.fillStyle = "#000000"; c.fillRect(0, 0, api.width, api.height);
        c.fillStyle = "#808080"; c.fillRect(0, gy, api.width, 20);
        c.fillStyle = "#ffffff"; c.beginPath(); c.arc(api.width / 2 + ball.position.x * k, gy - ball.position.y * k, 0.5 * k, 0, Math.PI * 2); c.fill();
      },
    };
  });`;
  test("同梱の cannon-es で球が落ちて床で止まり、dt=0 の呼び出しでは進まない", async ({ page }) => {
    await openHarness(page);
    expect((await start(page, drop, { libraries: [CANNON_ID] })).type).toBe("ready");
    const W = hex("#ffffff");
    const y0 = find(await shot(frame(page)), W).cy;
    await page.evaluate(() => (window as any).harness.focus());
    for (let i = 0; i < 5; i++) await page.keyboard.press("Space"); // 入力のたびに frame(t, 0)
    await page.locator("#frame").click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(100);
    expect(Math.abs(find(await shot(frame(page)), W).cy - y0)).toBeLessThan(0.5);
    await advance(page, 300);
    const y1 = find(await shot(frame(page)), W).cy;
    expect(y1 - y0).toBeGreaterThan(10); // 落ちている（画面では下へ）
    await advance(page, 3000);
    const a = await shot(frame(page));
    await advance(page, 500);
    const b = await shot(frame(page));
    const ya = find(a, W).cy, yb = find(b, W).cy;
    expect(Math.abs(ya - yb)).toBeLessThan(0.5); // 止まった
    expect(Math.abs(ya - (a.height - 20 - 20))).toBeLessThan(3); // 床（半径 20px の上）
    expect(await errorsOf(page)).toEqual([]);
  });

  // ピンボールのデモから：キーを押している間だけ運動学的なフリッパーが回り、球を上へ打ち上げる。
  test("運動学的な物体（フリッパー）を押下中だけ回し、球を打ち上げる", async ({ page }) => {
    const entry = `canvasApp.start((api) => {
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
      const L = 3, REST = -0.4, UP = 0.5;
      const flip = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC });
      flip.addShape(new CANNON.Box(new CANNON.Vec3(L / 2, 0.15, 1)), new CANNON.Vec3(L / 2, 0, 0));
      flip.position.set(-1.5, 1, 0); world.addBody(flip);
      const ball = new CANNON.Body({ mass: 0.2, shape: new CANNON.Sphere(0.3) }); world.addBody(ball);
      let angle = REST, held = false;
      const place = (w) => { flip.quaternion.setFromEuler(0, 0, angle); flip.angularVelocity.set(0, 0, w); };
      const restOn = () => { ball.position.set(-1.5 + 2.2 * Math.cos(REST), 1 + 2.2 * Math.sin(REST) + 0.5, 0); ball.velocity.setZero(); };
      place(0); restOn();
      return {
        input(ev) { if (ev.code === "Space" || ev.key === " ") held = ev.type === "keydown"; },
        frame(t, dt) {
          if (dt > 0) {
            let left = Math.min(dt / 1000, 0.1);
            while (left > 1e-6) {
              const h = Math.min(1 / 240, left), target = held ? UP : REST;
              const next = angle + Math.sign(target - angle) * Math.min(Math.abs(target - angle), 14 * h);
              const w = (next - angle) / h; angle = next; place(w); world.step(h); left -= h;
            }
          }
          const c = api.ctx, k = 30, ox = api.width / 2, oy = api.height - 40;
          c.fillStyle = "#000000"; c.fillRect(0, 0, api.width, api.height);
          c.save(); c.translate(ox + flip.position.x * k, oy - flip.position.y * k); c.rotate(-angle);
          c.fillStyle = "#ff0000"; c.fillRect(0, -0.15 * k, L * k, 0.3 * k); c.restore();
          c.fillStyle = "#ffffff"; c.beginPath(); c.arc(ox + ball.position.x * k, oy - ball.position.y * k, 0.3 * k, 0, Math.PI * 2); c.fill();
        },
      };
    });`;
    await openHarness(page);
    expect((await start(page, entry, { libraries: [CANNON_ID] })).type).toBe("ready");
    await advance(page, 500); // 球がフリッパーの上に落ち着く
    const s0 = await shot(frame(page));
    const red0 = find(s0, hex("#ff0000")), ball0 = find(s0, hex("#ffffff"));
    await page.evaluate(() => (window as any).harness.focus());
    await page.keyboard.down("Space");
    await advance(page, 100);
    const s1 = await shot(frame(page));
    const red1 = find(s1, hex("#ff0000")), ball1 = find(s1, hex("#ffffff"));
    expect(red0.cy - red1.cy).toBeGreaterThan(8); // フリッパーが上がった
    await advance(page, 150);
    const ball2 = find(await shot(frame(page)), hex("#ffffff"));
    expect(Math.min(ball1.cy, ball2.cy)).toBeLessThan(ball0.cy - 30); // 球が上へ打ち上がった
    await page.keyboard.up("Space");
    await advance(page, 300);
    expect(Math.abs(find(await shot(frame(page)), hex("#ff0000")).cy - red0.cy)).toBeLessThan(3); // 離すと戻る
    expect(await errorsOf(page)).toEqual([]);
  });

  test("Three.js と cannon-es を同時に宣言して、物理の位置を WebGL の場面に写せる", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "WebGL は Chromium だけで確かめる");
    const entry = `canvasApp.start((api) => {
      const gl = new OffscreenCanvas(1, 1), renderer = new THREE.WebGLRenderer({ canvas: gl });
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
      const camera = new THREE.OrthographicCamera(-4, 4, 6, -1, 0.1, 50); camera.position.z = 10;
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
      const floor = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() }); floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0); world.addBody(floor);
      const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.4), position: new CANNON.Vec3(0, 5, 0) }); world.addBody(body);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 12), new THREE.MeshBasicMaterial({ color: 0xffff00 })); scene.add(mesh);
      return {
        resize(w, h, dpr) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); const a = w / h; camera.left = -3.5 * a; camera.right = 3.5 * a; camera.updateProjectionMatrix(); },
        frame(t, dt) { if (dt > 0) world.step(1 / 60, dt / 1000, 5); mesh.position.copy(body.position); renderer.render(scene, camera); api.ctx.drawImage(gl, 0, 0, api.width, api.height); },
      };
    });`;
    await openHarness(page);
    expect((await start(page, entry, { libraries: [CANNON_ID, THREE_ID] })).type).toBe("ready");
    const y0 = find(await shot(frame(page)), hex("#ffff00")).cy;
    await advance(page, 600);
    const y1 = find(await shot(frame(page)), hex("#ffff00")).cy;
    expect(y1 - y0).toBeGreaterThan(40);
    expect(await errorsOf(page)).toEqual([]);
  });
});

test.describe("HTML の描画（api.decodeSVG）", () => {
  const card = (bg: string) => `'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:200px;height:100px;background:${bg};color:#ffffff;font:bold 28px sans-serif;padding:10px">HTML <span style="color:#ffff00">OK</span></div></foreignObject></svg>'`;
  const htmlArt = `canvasApp.start((api) => {
    let img = null, clicks = 0;
    const make = () => api.decodeSVG(clicks ? ${card("#ff8000")} : ${card("#2050ff")}).then((b) => { img = b; api.status({ decoded: clicks, w: b.width, h: b.height }); });
    make();
    return {
      input(ev) { if (ev.type === "pointerdown") { clicks++; make(); } },
      frame() { const c = api.ctx; c.fillStyle = "#000000"; c.fillRect(0, 0, api.width, api.height); if (img) c.drawImage(img, 40, 30); },
    };
  });`;
  test("HTML/CSS（foreignObject）が作品の画素になり、起動の完了は setup 中の復号を待つ。復号が済むと dt=0 で描き直す", async ({ page }) => {
    await openHarness(page);
    expect((await start(page, htmlArt)).type).toBe("ready");
    const s0 = await shot(frame(page)); // advance なしでも、ready の時点で描かれている
    const blue = find(s0, hex("#2050ff"), 20);
    expect(blue.box).not.toBeNull();
    expect(Math.abs(blue.box!.x - 40)).toBeLessThanOrEqual(1);
    expect(Math.abs(blue.box!.y - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(blue.box!.w - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(blue.box!.h - 100)).toBeLessThanOrEqual(1);
    expect(find(s0, hex("#ffffff"), 60, { x: 40, y: 30, w: 200, h: 100 }).count).toBeGreaterThan(80); // 文字（白）
    expect(find(s0, hex("#ffff00"), 60, { x: 40, y: 30, w: 200, h: 100 }).count).toBeGreaterThan(40); // 書式付きの文字（黄）
    await page.locator("#frame").click({ position: { x: 300, y: 250 } });
    expect(await waitStatus(page, (v) => v.decoded === 1)).not.toBeNull();
    await page.waitForTimeout(100); // advance なし：復号の完了で frame(t, 0) が呼ばれる
    const s1 = await shot(frame(page));
    expect(find(s1, hex("#ff8000"), 20).count).toBeGreaterThan(15000);
    expect(find(s1, hex("#2050ff"), 20).count).toBe(0);
    expect(await errorsOf(page)).toEqual([]);
  });

  test("HTML の画像を Three.js のテクスチャにできる（2D の面に写して CanvasTexture）", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "WebGL は Chromium だけで確かめる");
    const entry = `canvasApp.start((api) => {
      const gl = new OffscreenCanvas(1, 1), renderer = new THREE.WebGLRenderer({ canvas: gl });
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); camera.position.z = 4;
      const face = new OffscreenCanvas(200, 100), tex = new THREE.CanvasTexture(face);
      tex.colorSpace = THREE.SRGBColorSpace;
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshBasicMaterial({ map: tex })));
      api.decodeSVG(${card("#2050ff")}).then((b) => { face.getContext("2d").drawImage(b, 0, 0); tex.needsUpdate = true; });
      return {
        resize(w, h, dpr) { renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
        frame() { renderer.render(scene, camera); api.ctx.drawImage(gl, 0, 0, api.width, api.height); },
      };
    });`;
    await openHarness(page);
    expect((await start(page, entry, { libraries: [THREE_ID] })).type).toBe("ready");
    const s = await shot(frame(page));
    expect(find(s, hex("#2050ff"), 24).count).toBeGreaterThan(20000);
    expect(find(s, hex("#ffff00"), 70).count).toBeGreaterThan(100);
    expect(await errorsOf(page)).toEqual([]);
  });

  test("SVG の中の外部資源（img・CSS の url・@import）は読まれず、スクリプトは動かない。壊れた SVG・上限超えは Promise の失敗", async ({ page }) => {
    const id = uid();
    const svg = `'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><style>@import url(${CANARY}/svg-import-${id}.css);</style>` +
      `<image href="${CANARY}/svg-image-${id}.png" width="10" height="10"/><script>fetch("${CANARY}/svg-script-${id}")</script>` +
      `<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:120px;height:60px;background:#00ff00 url(${CANARY}/svg-bg-${id}.png)">` +
      `<img src="${CANARY}/svg-img-${id}.png" onerror="fetch(\\'${CANARY}/svg-onerror-${id}\\')"/></div></foreignObject></svg>'`;
    const entry = `canvasApp.start((api) => {
      const r = {}; let img = null;
      Promise.allSettled([
        api.decodeSVG(${svg}).then((b) => { img = b; return "ok"; }),
        api.decodeSVG("<svg"),
        api.decodeSVG("x".repeat(256 * 1024 + 1)),
        api.decodeSVG(42),
      ]).then((s) => api.status({ results: s.map((x) => x.status === "fulfilled" ? x.value : "rejected:" + String(x.reason && x.reason.message).slice(0, 60)) }));
      return { frame() { const c = api.ctx; c.fillStyle = "#000"; c.fillRect(0, 0, api.width, api.height); if (img) c.drawImage(img, 10, 10); } };
    });`;
    await openHarness(page);
    expect((await start(page, entry)).type).toBe("ready");
    const s = await waitStatus(page, (v) => v.results);
    expect(s.results[0]).toBe("ok");
    for (const x of s.results.slice(1)) expect(x).toMatch(/^rejected:decodeSVG/);
    expect(find(await shot(frame(page)), hex("#00ff00"), 20).count).toBeGreaterThan(5000);
    await page.waitForTimeout(500);
    expect((await canaryHits()).filter((h: any) => h.path.includes(id))).toEqual([]);
  });

  test("復号の依頼は毎秒 30 件を超えると失敗になり、作品は止まらない", async ({ page }) => {
    const entry = `canvasApp.start((api) => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>';
      const jobs = []; let ok = 0, ng = 0;
      const burst = () => { for (let i = 0; i < 8; i++) jobs.push(api.decodeSVG(svg).then(() => ok++, () => ng++)); };
      for (let k = 0; k < 6; k++) burst();
      Promise.allSettled(jobs).then(() => api.status({ ok, ng }));
      return { frame() { api.ctx.fillStyle = "#123456"; api.ctx.fillRect(0, 0, api.width, api.height); } };
    });`;
    await openHarness(page);
    expect((await start(page, entry)).type).toBe("ready");
    const s = await waitStatus(page, (v) => v.ok !== undefined);
    expect(s.ok + s.ng).toBe(48);
    expect(s.ok).toBeLessThanOrEqual(30);
    expect(s.ng).toBeGreaterThanOrEqual(18);
    expect((await events(page)).filter((e) => e.type === "violation")).toEqual([]);
  });
});

test.describe("同梱ライブラリと隔離", () => {
  test("ライブラリを宣言しても通信・eval・WebAssembly・importScripts・Three.js のローダーは拒否される", async ({ page }) => {
    const id = uid();
    const entry = `canvasApp.start((api) => {
      const r = {};
      (async () => {
        try { await fetch("${CANARY}/lib-fetch-${id}"); r.fetch = "reached"; } catch (e) { r.fetch = "blocked:" + e.name; }
        try { r.fn = String(new Function("return 1")()); } catch (e) { r.fn = "blocked:" + e.name; }
        try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); r.wasm = "compiled"; } catch (e) { r.wasm = "blocked:" + e.name; } r.wasmType = typeof WebAssembly;
        try { self["import" + "Scripts"]("${CANARY}/lib-is-${id}.js"); r.is = "reached"; } catch (e) { r.is = "blocked:" + e.name; }
        r.loader = await new Promise((res) => { try { new THREE.FileLoader().load("${CANARY}/lib-loader-${id}.json", () => res("reached"), undefined, () => res("blocked")); } catch (e) { res("blocked:" + e.name); } });
        r.three = THREE.REVISION; r.cannon = typeof CANNON.World;
        r.doc = typeof document; r.idb = typeof indexedDB;
      })().then(() => api.status({ probe: r }));
      return { frame() { api.ctx.fillStyle = "#222"; api.ctx.fillRect(0, 0, api.width, api.height); } };
    });`;
    await openHarness(page);
    expect((await start(page, entry, { libraries: [THREE_ID, CANNON_ID] })).type).toBe("ready");
    const s = (await waitStatus(page, (v) => v.probe, 8000)).probe;
    expect(s.fetch).toMatch(/^blocked/);
    expect(s.fn).toMatch(/^blocked/);
    expect(s.wasm).toMatch(/^blocked/);
    expect(s.wasmType).toBe("undefined");
    expect(s.is).toMatch(/^blocked/);
    expect(s.loader).toMatch(/^blocked/);
    expect(s.three).toBe("187");
    expect(s.cannon).toBe("function");
    expect(s.doc).toBe("undefined");
    expect(s.idb).toBe("undefined");
    await page.waitForTimeout(300);
    expect((await canaryHits()).filter((h: any) => h.path.includes(id))).toEqual([]);
  });

  test("宣言していないライブラリは使えない（契約の検査で拒否、検査を通る書き方でも実行時に未定義）", async ({ page }) => {
    await openHarness(page);
    expect((await start(page, `canvasApp.start(() => { new THREE.Scene(); return {}; });`)).type).toBe("rejected");
    expect((await start(page, `canvasApp.start(() => ({}));`, { libraries: ["three@0.150.0"] })).type).toBe("rejected");
    const r = await start(page, `canvasApp.start((api) => { api.status({ t: typeof THREE, c: typeof CANNON, libs: typeof __canvasLibs === "object" ? Object.keys(__canvasLibs) : null }); return { frame() { api.ctx.fillStyle = "#333"; api.ctx.fillRect(0, 0, api.width, api.height); } }; });`);
    expect(r.type).toBe("ready");
    const s = await waitStatus(page, (v) => "t" in v);
    expect(s).toEqual({ t: "undefined", c: "undefined", libs: [] });
  });
});
