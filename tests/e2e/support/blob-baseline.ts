// 不採用とした初期方式（sandbox="allow-scripts" の iframe ＋ Blob Worker）の基準線を再現する配信。
// 設計判断の根拠を再測定するためだけに使う。製品コードからは参照しない。
const CHILD_PROBE = `
const r = {};
const w = new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" })));
w.onmessage = () => { r.child = "ran"; };
w.onerror = () => { r.child = "error"; };
setTimeout(() => postMessage(JSON.stringify(r)), 1000);
`;
export function startBlobBaseline(hostPort: number, framePort: number) {
  const shellJs = `const w = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(CHILD_PROBE)}], { type: "text/javascript" })));
w.onmessage = (e) => parent.postMessage(e.data, "*");`;
  Bun.serve({
    port: hostPort,
    hostname: "localhost",
    fetch: () =>
      new Response(`<iframe sandbox="allow-scripts" src="http://127.0.0.1:${framePort}/shell.html"></iframe><script>addEventListener("message", (e) => { document.title = "R:" + e.data; });</script>`, {
        headers: { "content-type": "text/html" },
      }),
  });
  Bun.serve({
    port: framePort,
    hostname: "127.0.0.1",
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/shell.html")
        return new Response(`<script src="/shell.js"></script>`, {
          headers: { "content-type": "text/html", "content-security-policy": "default-src 'none'; script-src 'self'; worker-src blob:" },
        });
      if (p === "/shell.js") return new Response(shellJs, { headers: { "content-type": "text/javascript" } });
      return new Response("nf", { status: 404 });
    },
  });
}
