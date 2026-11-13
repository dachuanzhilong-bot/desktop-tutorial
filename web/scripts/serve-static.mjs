// Tiny static file server for the exported app (out/) – used by Playwright and for local previews.
//   node scripts/serve-static.mjs [port] [dir]
//   BASE_PATH=/desktop-tutorial node scripts/serve-static.mjs …   serves the export under a sub-path, like a GitHub Pages project site
//   E2E_HOOKS=1 node scripts/serve-static.mjs …   for the e2e tests only (see swVariant below)
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.argv[2] ?? process.env.PORT ?? 3100);
const root = resolve(process.argv[3] ?? "out");
const base = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".gz": "application/gzip",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
};
// what a real static host compresses
const COMPRESS = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt", ".wasm", ".bin"]);
const gz = new Map();
const hooks = process.env.E2E_HOOKS === "1";

/**
 * e2e only: a browser that sends the cookie tessera-e2e-sw=<name> gets a "newer deploy" of sw.js, its VERSION and
 * BUILD ending in -<name>. Playwright cannot intercept a service worker's own update check, so this is how a test
 * makes the browser find and install a really different worker (e2e/offline.spec.ts). The cookie belongs to one
 * browser context, so tests running in parallel are not affected.
 */
function swVariant(req) {
  if (!hooks) return "";
  const m = /(?:^|;\s*)tessera-e2e-sw=([A-Za-z0-9]+)/.exec(String(req.headers.cookie ?? ""));
  return m ? m[1] : "";
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let pathname = decodeURIComponent(url.pathname);
  if (base) {
    // like a project site: <base> without the slash redirects, anything outside <base> is not ours
    if (pathname === base) {
      res.writeHead(301, { location: `${base}/${url.search}` });
      res.end();
      return;
    }
    if (!pathname.startsWith(`${base}/`)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    pathname = pathname.slice(base.length);
  }
  let p = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, p);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end(existsSync(join(root, "404.html")) ? readFileSync(join(root, "404.html")) : "not found");
    return;
  }
  const headers = { "content-type": TYPES[extname(file)] ?? "application/octet-stream" };
  if (file.endsWith("sw.js")) headers["cache-control"] = "no-cache";
  else if (p.startsWith("/_next/static/")) headers["cache-control"] = "public, max-age=31536000, immutable";
  let body = readFileSync(file);
  const variant = file.endsWith("sw.js") ? swVariant(req) : "";
  if (variant) body = Buffer.from(String(body).replace(/const (VERSION|BUILD) = "([^"]*)";/g, (_, name, value) => `const ${name} = "${value}-${variant}";`));
  if (COMPRESS.has(extname(file)) && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
    // cache per file *and* modification time: the export is rebuilt while this server may keep running
    const key = `${file}:${statSync(file).mtimeMs}:${variant}`;
    let z = gz.get(key);
    if (!z) gz.set(key, (z = gzipSync(body)));
    body = z;
    headers["content-encoding"] = "gzip";
    headers.vary = "Accept-Encoding";
  }
  res.writeHead(200, headers);
  res.end(body);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
