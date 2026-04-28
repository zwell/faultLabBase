/**
 * Phase 1 stub: /health only. Phase 3 expands to full API per CLAUDE.md.
 */
const http = require("http");

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(503, { "Content-Type": "text/plain" });
  res.end("service starting");
});

server.listen(3000, "0.0.0.0", () => {
  process.stdout.write("[api] listening on :3000 (phase1 stub)\n");
});
