// Tiny static server for running AMIDisplay on the media laptop.
// Chrome only allows the microphone on https:// or http://localhost, so open the localhost link.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 5173);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
    const type = types[path.extname(file)] || "application/octet-stream";
    const gzip = /gzip/.test(req.headers["accept-encoding"] || "") && /json|javascript|css|html|svg/.test(type);
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache", ...(gzip ? { "content-encoding": "gzip" } : {}) });
    res.end(gzip ? zlib.gzipSync(body) : body);
  });
}).listen(port, () => {
  console.log(`AMIDisplay is running. Open http://localhost:${port} in Google Chrome.`);
});
