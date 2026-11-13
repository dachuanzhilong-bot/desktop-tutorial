import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

async function filesUnder(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}

/**
 * Next's static export nests route payloads under __next.<route>/..., while its
 * client prefetch requests the equivalent dotted .txt URL. Copy the payload to
 * that URL so static hosts can serve it without rewrite rules.
 */
export async function prepareStaticExport(root = resolve("out")) {
  const absoluteRoot = resolve(root);
  let copied = 0;
  for (const source of await filesUnder(absoluteRoot)) {
    if (!source.endsWith(`${sep}__PAGE__.txt`)) continue;
    const parts = relative(absoluteRoot, source).split(sep);
    const rscIndex = parts.findIndex((part) => part.startsWith("__next."));
    if (rscIndex < 0) continue;

    const routeParts = [parts[rscIndex].slice("__next.".length), ...parts.slice(rscIndex + 1, -1)];
    if (routeParts.some((part) => !part || part === "__PAGE__")) continue;
    const aliasName = `__next.${routeParts.join(".")}.__PAGE__.txt`;
    const alias = join(absoluteRoot, ...parts.slice(0, rscIndex), aliasName);
    if (existsSync(alias)) continue;
    await mkdir(join(absoluteRoot, ...parts.slice(0, rscIndex)), { recursive: true });
    await copyFile(source, alias);
    copied++;
  }
  return copied;
}

/** a path segment that is never a page of its own: Next's internals (_next, _not-found) and the 404 page */
const notAPage = (part) => part.startsWith("_") || part === "404";

/**
 * The files of the Web Workers the bundler made from `new Worker(new URL("…worker.ts", import.meta.url))`
 * (src/workers/): the worker's entry script and the chunks it loads, as "/_next/static/chunks/…". No page's HTML
 * names them (the page's own scripts do, when they start the worker), so the service worker would otherwise only
 * have them after a worker was first started online. Found in the chunks that start a worker, where Turbopack writes
 * `"static/chunks/turbopack-worker-<hash>.js",["static/chunks/<chunk>.js",…]`.
 */
export async function workerFiles(root = resolve("out")) {
  const absoluteRoot = resolve(root);
  const chunks = join(absoluteRoot, "_next", "static", "chunks");
  if (!existsSync(chunks)) return [];
  const found = new Set();
  const pattern = /"(static\/chunks\/turbopack-worker-[^"]+\.js)",\[([^\]]*)\]/g;
  for (const file of await filesUnder(chunks)) {
    if (!file.endsWith(".js")) continue;
    for (const m of (await readFile(file, "utf8")).matchAll(pattern)) {
      for (const f of [m[1], ...[...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1])]) {
        if (!existsSync(join(absoluteRoot, "_next", f))) throw new Error(`a worker loads _next/${f}, which is not in ${absoluteRoot}`);
        found.add(`/_next/${f}`);
      }
    }
  }
  return [...found];
}

/**
 * What the service worker caches when it installs, for the app to open offline: every page of the export
 * (<dir>/index.html → "/<dir>/"), the files of the bundled workers, the web app manifest and the icons. Sorted, so the
 * same export gives the same list. Routes and workers are found in the export itself: neither needs a change to sw.js.
 */
export async function precacheList(root = resolve("out")) {
  const absoluteRoot = resolve(root);
  const list = [];
  for (const file of await filesUnder(absoluteRoot)) {
    const parts = relative(absoluteRoot, file).split(sep);
    const name = parts[parts.length - 1];
    const dirs = parts.slice(0, -1);
    if (name === "index.html" && !dirs.some(notAPage)) list.push(dirs.length ? `/${dirs.join("/")}/` : "/");
    else if (parts.length === 1 && name === "manifest.webmanifest") list.push("/manifest.webmanifest");
    else if (parts.length === 2 && parts[0] === "icons") list.push(`/icons/${name}`);
  }
  if (!list.includes("/")) throw new Error(`${absoluteRoot} has no index.html: not a static export`);
  list.push(...(await workerFiles(absoluteRoot)));
  return list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Write the precache list into the exported worker (`const PRECACHE = [...];` in out/sw.js). A worker without that
 * line fails the build: the app would install without its pages and not open offline.
 */
export async function embedPrecacheList(root = resolve("out")) {
  const path = join(resolve(root), "sw.js");
  const source = await readFile(path, "utf8");
  const pattern = /const PRECACHE = \[[^\]]*\];/;
  if (!pattern.test(source)) throw new Error(`${path} has no \`const PRECACHE = [];\` line to fill in`);
  const list = await precacheList(root);
  await writeFile(path, source.replace(pattern, () => `const PRECACHE = ${JSON.stringify(list)};`));
  return list;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const copied = await prepareStaticExport(process.argv[2] ?? "out");
  console.log(`Prepared ${copied} static route payload URL${copied === 1 ? "" : "s"}.`);
  const list = await embedPrecacheList(process.argv[2] ?? "out");
  const workers = list.filter((u) => u.startsWith("/_next/"));
  // the app starts workers (src/workers/): none found means the bundler now writes them some other way, and Solve,
  // ICM and the postflop viewer would not open offline before their first online use
  if (!workers.some((u) => u.includes("turbopack-worker-"))) throw new Error("no bundled Web Worker found in the export: see workerFiles()");
  console.log(`Service worker precaches ${list.length} files (${list.filter((u) => u.endsWith("/")).length} pages, ${workers.length} worker files).`);
}
