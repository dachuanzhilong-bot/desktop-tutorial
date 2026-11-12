/* Tessera service worker – offline-first for the app shell and the solution data.
 *
 *  - precache: pages + solution files listed in /solutions/index.json (written by scripts/pack-solutions.mjs)
 *  - /_next/static, /icons: cache-first; /solutions, /postflop, /wasm, /solver-worker.js: stale-while-revalidate
 *  - navigations: network-first with a short timeout, falling back to the cache, then to the home page
 *  Bump VERSION to drop old caches (the solution data); BUILD is stamped by the build and renews the app shell cache.
 */
// the app may live under a sub-path (GitHub Pages project site): the scope of this worker is that path
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const VERSION = "v9";
// written into the built copy of this file by scripts/stamp-sw.mjs: every build gets its own worker, so a new deploy is noticed
const BUILD = "dev";
const CORE = `tessera-core-${VERSION}-${BUILD}`;
const DATA = `tessera-data-${VERSION}`;
const PAGES = ["/", "/study/", "/study/postflop/", "/study/report/", "/study/saved/", "/learn/", "/solve/", "/builder/", "/icm/", "/equity/", "/odds/", "/practice/", "/stats/", "/analyze/", "/settings/", "/glossary/", "/roadmap/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png"].map((u) => BASE + u);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const core = await caches.open(CORE);
      // 'reload': a new version must come from the server, not from the browser's own copy of the old pages
      await Promise.all(PAGES.map((u) => core.add(new Request(u, { cache: "reload" })).catch(() => {})));
      // every page's JS/CSS must be available offline, not only those of the pages visited so far:
      // discover the hashed /_next/static assets referenced by the cached HTML and cache them too
      const assets = new Set();
      for (const u of PAGES) {
        const res = await core.match(u);
        if (!res || !(res.headers.get("content-type") || "").includes("text/html")) continue;
        const html = await res.clone().text();
        for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) assets.add(BASE + m[0]);
      }
      await Promise.all([...assets].map((u) => core.add(u).catch(() => {})));
      try {
        const res = await fetch(BASE + "/solutions/index.json", { cache: "no-store" });
        const idx = await res.json();
        const data = await caches.open(DATA);
        // files already in the cache are not fetched again: the data only changes with VERSION, and is refreshed on use
        const addNew = async (u) => {
          if (!(await data.match(BASE + u))) await data.add(BASE + u).catch(() => {});
        };
        await Promise.all(idx.solutions.flatMap((s) => s.files).map(addNew));
        await data.put(BASE + "/solutions/index.json", new Response(JSON.stringify(idx), { headers: { "content-type": "application/json" } }));
        // postflop flops are large: only the index is precached, each flop is cached the first time it is opened
        await data.add(BASE + "/postflop/index.json").catch(() => {});  // small; fetched again so the list of flops is current
        // the Solve screen runs the WebAssembly solver in a worker: keep both offline
        await Promise.all(["/wasm/tessera_solver.wasm", "/solver-worker.js", "/data/equity169.bin"].map(addNew));
      } catch (_) {
        /* offline install: data will be cached on first use */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CORE, DATA]);
      for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await net) || Response.error();
}

async function networkFirst(req) {
  const cache = await caches.open(CORE);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const res = await fetch(req, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    return (await cache.match(req)) || (await cache.match(new URL(req.url).pathname)) || (await cache.match(BASE + "/")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // other apps on the same origin (other project sites) are none of our business
  if (BASE && url.pathname !== BASE && !url.pathname.startsWith(BASE + "/")) return;
  const path = url.pathname.slice(BASE.length) || "/";
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req, CORE));
  } else if (path.startsWith("/solutions/") || path.startsWith("/postflop/") || path.startsWith("/wasm/") || path.startsWith("/data/") || path === "/solver-worker.js") {
    event.respondWith(staleWhileRevalidate(req, DATA));
  } else if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html") || path.endsWith(".webmanifest")) {
    event.respondWith(networkFirst(req));
  } else if (url.search.includes("_rsc")) {
    event.respondWith(networkFirst(req));
  }
});
