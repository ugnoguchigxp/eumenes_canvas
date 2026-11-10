// render-v1 R-V1-blackhole の参照の作品（examples/render/black-hole.js を縮めたもの。影の半径を高さの約 15% にするため距離 30 から見る）。
// libraries: ["three@0.187.0"]
canvasApp.start((api) => {
  const SCALE = 0.5; // ソフトウェア描画でも間に合うよう、半分の解像度で描いて引き伸ばす
  const gl = new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: false });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uIncl: { value: 0.175 },
    uSpin: { value: 1.0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime, uIncl, uSpin;
      uniform vec2 uRes;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      vec3 stars(vec3 d){
        vec3 c = vec3(0.0);
        for (int i = 0; i < 2; i++) {
          float s = 60.0 + float(i) * 90.0;
          vec3 q = floor(d * s);
          float h = hash(q);
          if (h > 0.985) { vec3 f = fract(d * s) - 0.5; c += vec3(0.8, 0.85, 1.0) * smoothstep(0.25, 0.0, length(f)) * (h - 0.985) * 66.0; }
        }
        return c + vec3(0.02, 0.025, 0.05) * (0.5 + 0.5 * d.y);
      }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1,0), 1.0)), c = hash(vec3(i + vec2(0,1), 1.0)), d = hash(vec3(i + vec2(1,1), 1.0));
        return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
        // カメラ：距離 22（シュヴァルツシルト半径 = 1）、円盤の面から uIncl だけ上から見る
        float ci = cos(uIncl), si = sin(uIncl);
        vec3 ro = vec3(0.0, 30.0 * si, 30.0 * ci);
        vec3 fw = normalize(-ro), rt = normalize(cross(fw, vec3(0,1,0))), up = cross(rt, fw);
        vec3 rd = normalize(fw * 1.6 + rt * p.x * 0.9 + up * p.y * 0.9);
        vec3 pos = ro, vel = rd;
        vec3 h = cross(pos, vel); float h2 = dot(h, h);
        vec3 col = vec3(0.0); float alpha = 0.0; bool captured = false;
        for (int i = 0; i < 160; i++) {
          float r = length(pos);
          float dt = clamp(0.08 * r, 0.04, 1.2);
          vec3 acc = -1.5 * h2 * pos / pow(r, 5.0);
          vec3 prev = pos;
          vel += acc * dt; pos += vel * dt;
          if (prev.y * pos.y < 0.0) {
            vec3 hit = mix(prev, pos, prev.y / (prev.y - pos.y));
            float rr = length(hit.xz);
            if (rr > 3.0 && rr < 11.0) {
              // 円盤の模様：半径ごとの角速度（ケプラー回転）で回した座標の値ノイズ（atan の継ぎ目を避ける）
              float omega = uSpin * 2.2 / pow(rr, 1.5);
              float ca = cos(omega * uTime), sa = sin(omega * uTime);
              vec2 q = mat2(ca, -sa, sa, ca) * hit.xz;
              float bands = (noise(q * 1.7) * 0.5 + noise(vec2(rr * 3.1, 0.5)) * 0.5) * 0.7 + 0.3;
              float temp = pow(3.0 / rr, 2.2);
              vec3 tangent = normalize(vec3(-hit.z, 0.0, hit.x));
              float dop = 1.0 + 0.55 * dot(tangent, -normalize(vel)) ; // 近づく側が明るい
              vec3 c = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.92, 0.75), clamp(temp, 0.0, 1.0)) * temp * 3.2 * bands * pow(dop, 3.0);
              float a = smoothstep(3.0, 3.6, rr) * smoothstep(11.0, 8.0, rr) * 0.9;
              col += (1.0 - alpha) * c * a; alpha += (1.0 - alpha) * a;
              if (alpha > 0.98) break;
            }
          }
          if (r < 1.0) { captured = true; break; }
          if (r > 50.0) break;
        }
        if (!captured) col += (1.0 - alpha) * stars(normalize(vel));
        col = col / (1.0 + col); // 簡単なトーンマップ
        gl_FragColor = vec4(pow(col, vec3(0.8)), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const keys = new Set();
  return {
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr * SCALE);
      renderer.setSize(w, h, false);
      uniforms.uRes.value.set(w, h);
    },
    input(ev) {
      if (ev.type === "keydown") keys.add(ev.code);
      else if (ev.type === "keyup") keys.delete(ev.code);
    },
    frame(t, dt) {
      if (dt > 0) {
        const s = dt / 1000;
        uniforms.uTime.value += s;
        if (keys.has("ArrowUp")) uniforms.uIncl.value = Math.min(1.4, uniforms.uIncl.value + 0.6 * s);
        if (keys.has("ArrowDown")) uniforms.uIncl.value = Math.max(0.02, uniforms.uIncl.value - 0.6 * s);
      }
      renderer.render(scene, camera);
      api.ctx.imageSmoothingEnabled = true;
      api.ctx.drawImage(gl, 0, 0, api.width, api.height);
    },
  };
});
