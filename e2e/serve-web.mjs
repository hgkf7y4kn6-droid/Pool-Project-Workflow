// Static server for the exported web app, with the cross-origin isolation
// headers the web SQLite build needs.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".web");
const port = Number(process.argv[3] ?? 8099);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".ttf": "font/ttf", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
http
  .createServer((req, res) => {
    let file = path.join(root, decodeURIComponent((req.url ?? "/").split("?")[0]));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`web app on http://localhost:${port}`));
