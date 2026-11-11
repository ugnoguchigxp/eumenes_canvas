// ページ直接モード（docs/artwork-contract-v2-page.md）の試験用の作品：跳ねる四角。クリックで色が変わり、矢印キーで速さが変わる。
const stage = document.getElementById("stage");
const ctx = stage.getContext("2d");
const colors = ["#ff3030", "#30c0ff", "#ffd030"];
let ci = 0;
let x = 20, y = 20, vx = 0.18, vy = 0.13, last = null;
stage.addEventListener("pointerdown", () => { ci = (ci + 1) % colors.length; });
addEventListener("keydown", (e) => {
  if (e.code === "ArrowRight") vx *= 1.5;
  if (e.code === "ArrowLeft") vx /= 1.5;
});
function frame(t) {
  const dt = last === null ? 0 : t - last;
  last = t;
  const w = stage.width, h = stage.height, s = Math.max(20, Math.round(Math.min(w, h) / 8));
  x += vx * dt; y += vy * dt;
  if (x < 0 || x + s > w) { vx = -vx; x = Math.max(0, Math.min(w - s, x)); }
  if (y < 0 || y + s > h) { vy = -vy; y = Math.max(0, Math.min(h - s, y)); }
  ctx.fillStyle = "#101820";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = colors[ci];
  ctx.fillRect(Math.round(x), Math.round(y), s, s);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
