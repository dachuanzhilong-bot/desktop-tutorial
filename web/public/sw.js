/* Tessera service worker – offline-first for the app shell and the solution data.
 *
 *  Two caches:
 *  - tessera-core-<VERSION>-<BUILD>: the app itself (pages, /_next/static, icons, manifest). BUILD is stamped by every
 *    build, so a new deploy gets a new cache and the old app is dropped as a whole.
 *  - tessera-data: the solution data, the WebAssembly solver and its data. No version in the name: it survives app
 *    updates, so the flops opened once stay available offline.
 *
 *  - precache: every page of the export and the bundled Web Workers (PRECACHE, written by
 *    scripts/prepare-static-export.mjs) and the solution files listed in /solutions/index.json (written by
 *    scripts/pack-solutions.mjs)
 *  - solution files are fetched and cached as <file>?b=<build> (the build ID of index.json, scripts/build-id.mjs): the
 *    content of such an address never changes, so they are cache-first. Activation drops the entries whose build the
 *    current index.json files no longer list (an older generation of the data).
 *  - /solutions/index.json, /postflop/index.json: network-first, so an online start knows the current builds
 *  - /_next/static, /icons: cache-first; /wasm, /data (no build in their address): stale-while-revalidate
 *  - navigations: network-first with a short timeout, falling back to the cache, then to the home page
 */
// the app may live under a sub-path (GitHub Pages project site): the scope of this worker is that path
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const VERSION = "v12";
// written into the built copy of this file by scripts/stamp-sw.mjs: every build gets its own worker, so a new deploy is noticed
const BUILD = "dev";
const CORE = `tessera-core-${VERSION}-${BUILD}`;
const DATA = "tessera-data";
// written into the built copy of this file by scripts/prepare-static-export.mjs: every page of out/, the files of the
// bundled workers (the solver, the flop decoder: no page's HTML names them), the manifest and the icons
const PRECACHE = [];
const PAGES = PRECACHE.map((u) => BASE + u);
const INDEXES = ["/solutions/index.json", "/postflop/index.json"];

/** fetch with a time limit: a slow network is treated like no network */
async function fetchWithin(req, ms, init = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(req, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
        // files already in the cache are not fetched again: an address with ?b=<build> always has the same content
        const addNew = async (u) => {
          if (!(await data.match(BASE + u))) await data.add(BASE + u).catch(() => {});
        };
        // the same addresses the app asks for (lib/solution/loader.ts): with the build ID of the solution
        await Promise.all(idx.solutions.flatMap((s) => s.files.map((f) => (s.build ? `${f}?b=${s.build}` : f))).map(addNew));
        await data.put(BASE + "/solutions/index.json", new Response(JSON.stringify(idx), { headers: { "content-type": "application/json" } }));
        // postflop flops are large: only the index is precached, each flop is cached the first time it is opened
        // (as <n>.bin.gz?b=<build>, the address lib/postflop/loader.ts asks for)
        await data.add(BASE + "/postflop/index.json").catch(() => {}); // small; fetched again so the list of flops is current
        // Solve and ICM run the WebAssembly solver in a worker (in PRECACHE): keep the module and its data offline
        await Promise.all(["/wasm/tessera_solver.wasm", "/data/equity169.bin"].map(addNew));
      } catch (_) {
        /* offline install: data will be cached on first use */
      }
      await self.skipWaiting();
    })(),
  );
});

/**
 * The build IDs the current index files know, read from the network; null when either cannot be fetched or read
 * (offline): then nothing is dropped, an offline start must not break the cache.
 */
async function currentBuilds() {
  try {
    const [pre, post] = await Promise.all(
      INDEXES.map(async (u) => {
        const res = await fetchWithin(BASE + u, 5000, { cache: "no-store" });
        if (!res.ok) throw new Error(`${u} ${res.status}`);
        return res.json();
      }),
    );
    const builds = new Set([...pre.solutions.map((s) => s.build), ...Object.values(post.build)]);
    if (builds.has(undefined) || builds.size === 0) return null;
    return builds;
  } catch (_) {
    return null;
  }
}

/** drop the solution files of an older generation of the data: entries whose ?b=<build> is not current */
async function dropOldData() {
  const builds = await currentBuilds();
  if (!builds) return;
  const data = await caches.open(DATA);
  for (const req of await data.keys()) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(BASE + "/")) continue; // another app on the same origin
    const path = url.pathname.slice(BASE.length);
    const build = url.searchParams.get("b");
    if ((path.startsWith("/solutions/") || path.startsWith("/postflop/")) && build !== null && !builds.has(build)) await data.delete(req);
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // older app caches, and the versioned data caches of earlier workers (tessera-data-v10 …): what they held is
      // fetched again on use, and the install step above has already put the solution files into DATA
      const keep = new Set([CORE, DATA]);
      for (const k of await caches.keys()) if (k.startsWith("tessera-") && !keep.has(k)) await caches.delete(k);
      // the hand-written solver worker of earlier versions (now bundled under /_next/static, in CORE)
      await (await caches.open(DATA)).delete(BASE + "/solver-worker.js");
      await dropOldData();
      await self.clients.claim();
    })(),
  );
});

/**
 * A worker's script from the cache, as a response of its own: the worker then keeps the address it was started with.
 * A cached response carries the cached address, and the Cache API drops the #fragment, where Next's bundled-worker
 * entry (turbopack-worker-*.js) reads its configuration ("#params=…"); without it the worker stops at once.
 */
const forWorker = (req, res) =>
  req.destination === "worker" || req.destination === "sharedworker" ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return forWorker(req, hit);
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

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetchWithin(req, 3500);
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
  } else if (INDEXES.includes(path)) {
    event.respondWith(networkFirst(req, DATA));
  } else if ((path.startsWith("/solutions/") || path.startsWith("/postflop/")) && url.searchParams.has("b")) {
    // the build ID is part of the address: what is cached under it is never stale
    event.respondWith(cacheFirst(req, DATA));
  } else if (path.startsWith("/solutions/") || path.startsWith("/postflop/") || path.startsWith("/wasm/") || path.startsWith("/data/")) {
    event.respondWith(staleWhileRevalidate(req, DATA));
  } else if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html") || path.endsWith(".webmanifest")) {
    event.respondWith(networkFirst(req, CORE));
  } else if (url.search.includes("_rsc")) {
    event.respondWith(networkFirst(req, CORE));
  }
});
