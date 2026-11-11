import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
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
 * A short fingerprint of the built app: the names of the hashed scripts and styles (their names already carry their
 * content) and the text of every page. The large solution files are left out; they keep their own cache and version.
 */
export async function buildStamp(root = resolve("out")) {
  const absoluteRoot = resolve(root);
  const hash = createHash("sha256");
  const files = (await filesUnder(absoluteRoot)).map((f) => ({ f, rel: relative(absoluteRoot, f).split(sep).join("/") })).sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const { f, rel } of files) {
    if (rel.startsWith("_next/static/")) hash.update(`${rel}\n`);
    else if (rel.endsWith(".html")) hash.update(`${rel}\n`).update(await readFile(f));
  }
  return hash.digest("hex").slice(0, 10);
}

/**
 * A browser installs a new service worker only when sw.js itself has changed. Every build writes its fingerprint into
 * the file (`const BUILD = "..."`), so a deployed update is noticed, its pages are cached again, and the page can say so.
 */
export async function stampServiceWorker(root = resolve("out")) {
  const path = join(resolve(root), "sw.js");
  const source = await readFile(path, "utf8");
  const pattern = /const BUILD = "[^"]*";/;
  if (!pattern.test(source)) throw new Error(`${path} has no \`const BUILD = "...";\` line to stamp`);
  const stamp = await buildStamp(root);
  await writeFile(path, source.replace(pattern, `const BUILD = "${stamp}";`));
  return stamp;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(`Service worker stamped with build ${await stampServiceWorker(process.argv[2] ?? "out")}.`);
}
