/* Tessera service worker – offline-first for the app shell and the solution data.
 *
 *  - precache: pages + solution files listed in /solutions/index.json (written by scripts/pack-solutions.mjs)
 *  - /_next/static, /icons, /solutions: cache-first (stale-while-revalidate for solutions)
 *  - navigations: network-first with a short timeout, falling back to the cache, then to "/"
 *  Bump VERSION to drop old caches.
 */
const VERSION = "v1";
const CORE = `tessera-core-${VERSION}`;
const DATA = `tessera-data-${VERSION}`;
const PAGES = ["/", "/study/", "/practice/", "/stats/", "/settings/", "/glossary/", "/roadmap/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const core = await caches.open(CORE);
      await Promise.all(PAGES.map((u) => core.add(u).catch(() => {})));
      // every page's JS/CSS must be available offline, not only those of the pages visited so far:
      // discover the hashed /_next/static assets referenced by the cached HTML and cache them too
      const assets = new Set();
      for (const u of PAGES) {
        const res = await core.match(u);
        if (!res || !(res.headers.get("content-type") || "").includes("text/html")) continue;
        const html = await res.clone().text();
        for (const m of html.matchAll(/\/_next\/static\/[^"'\\\s)<>]+/g)) assets.add(m[0]);
      }
      await Promise.all([...assets].map((u) => core.add(u).catch(() => {})));
      try {
        const res = await fetch("/solutions/index.json", { cache: "no-store" });
        const idx = await res.json();
        const data = await caches.open(DATA);
        await Promise.all(idx.solutions.flatMap((s) => s.files).map((u) => data.add(u).catch(() => {})));
        await data.put("/solutions/index.json", new Response(JSON.stringify(idx), { headers: { "content-type": "application/json" } }));
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
    return (await cache.match(req)) || (await cache.match(new URL(req.url).pathname)) || (await cache.match("/")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req, CORE));
  } else if (url.pathname.startsWith("/solutions/")) {
    event.respondWith(staleWhileRevalidate(req, DATA));
  } else if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html") || url.pathname.endsWith(".webmanifest")) {
    event.respondWith(networkFirst(req));
  } else if (url.search.includes("_rsc")) {
    event.respondWith(networkFirst(req));
  }
});
