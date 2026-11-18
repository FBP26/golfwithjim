// Local preview: serves public/ on :8787 and the Worker API on :8788 backed by a SQLite copy.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { d1, installCache } from "./d1-shim.mjs";
import worker from "../worker.js";
installCache();
const DB = d1(process.argv[2]);
const env = { DB, GOLF_ADMIN_PASSWORD: "preview", ALLOWED_ORIGINS: "http://localhost:8787" };
const root = new URL("../../public/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html";
  const f = join(root, p); if (!existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
}).listen(8787);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(`http://api${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8788);
console.log("preview on http://localhost:8787/stats/?api=http://localhost:8788");
