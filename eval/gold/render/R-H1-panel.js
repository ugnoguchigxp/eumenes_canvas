// render-v1 R-H1-panel の参照の作品。HTML/CSS のパネルを api.decodeSVG で画像にして描く。ライブラリは使わない。
canvasApp.start((api) => {
  const X = 40, Y = 40, W = 240, H = 120;
  let score = 0, orange = false, img = null, pending = false, dirty = false;
  function markup() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W * api.dpr) + '" height="' + Math.round(H * api.dpr) + '" viewBox="0 0 ' + W + " " + H + '">' +
      '<foreignObject width="' + W + '" height="' + H + '"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:' + W + "px;height:" + H + "px;padding:8px 16px;background:" + (orange ? "#ff8000" : "#2050ff") + '">' +
      '<div style="font:700 24px sans-serif;color:#ffffff;line-height:30px">SCORE</div>' +
      '<div style="font:700 40px sans-serif;color:#ffff00;line-height:48px">' + score + "</div></div></foreignObject></svg>";
  }
  function rebuild() {
    if (pending) { dirty = true; return; }
    pending = true;
    api.decodeSVG(markup()).then((b) => {
      if (img) img.close();
      img = b;
      pending = false;
      if (dirty) { dirty = false; rebuild(); }
    }, () => { pending = false; });
  }
  rebuild();
  return {
    resize: rebuild,
    input(ev) {
      if (ev.type === "keydown" && ev.code === "ArrowUp") { score++; rebuild(); }
      if (ev.type === "pointerdown" && ev.x >= X && ev.x < X + W && ev.y >= Y && ev.y < Y + H) { orange = !orange; rebuild(); }
    },
    frame() {
      const c = api.ctx;
      c.fillStyle = "#000000";
      c.fillRect(0, 0, api.width, api.height);
      if (img) c.drawImage(img, X, Y, W, H);
    },
  };
});
