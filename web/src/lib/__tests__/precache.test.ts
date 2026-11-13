import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { embedPrecacheList, precacheList } from "../../../scripts/prepare-static-export.mjs";

const SW = 'const BUILD = "dev";\n// filled in by the build\nconst PRECACHE = [];\nconst PAGES = PRECACHE.map((u) => BASE + u);\n';

/** a small static export: pages, Next's internals, the 404 page, data, the manifest and the icons */
async function site(extra: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), "tessera-precache-"));
  const files = [
    "index.html",
    "404.html",
    "404/index.html",
    "_not-found/index.html",
    "_not-found/__next._not-found.__PAGE__.txt",
    "__next.__PAGE__.txt",
    "_next/static/chunks/app-abc.js",
    "_next/static/media/index.html",
    "study/index.html",
    "study/__next.study.__PAGE__.txt",
    "study/__next.study/__PAGE__.txt",
    "study/postflop/index.html",
    "practice/index.html",
    "practice/index.txt",
    "solutions/index.json",
    "solutions/cash6max-100bb/chunk-0.bin.gz",
    "postflop/srp-btn-bb/0.bin.gz",
    "wasm/tessera_solver.wasm",
    "manifest.webmanifest",
    "icons/icon.svg",
    "icons/icon-192.png",
    "sw.js",
    ...extra,
  ];
  for (const f of files) {
    await mkdir(dirname(join(root, f)), { recursive: true });
    await writeFile(join(root, f), f === "sw.js" ? SW : f);
  }
  return root;
}

test("lists every page of the export, the manifest and the icons, in a fixed order", async () => {
  const root = await site();
  try {
    expect(await precacheList(root)).toEqual(["/", "/icons/icon-192.png", "/icons/icon.svg", "/manifest.webmanifest", "/practice/", "/study/", "/study/postflop/"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a new route is picked up without touching the worker", async () => {
  const root = await site(["drills/texture/index.html"]);
  try {
    expect(await precacheList(root)).toContain("/drills/texture/");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes the list into the exported worker, and writing again gives the same file", async () => {
  const root = await site();
  try {
    const list = await embedPrecacheList(root);
    const sw = await readFile(join(root, "sw.js"), "utf8");
    expect(sw).toBe(SW.replace("const PRECACHE = [];", `const PRECACHE = ${JSON.stringify(list)};`));
    expect(list).toHaveLength(7);
    await embedPrecacheList(root);
    expect(await readFile(join(root, "sw.js"), "utf8")).toBe(sw);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses a worker without the line to fill in, and a folder that is not an export", async () => {
  const root = await site();
  const empty = await mkdtemp(join(tmpdir(), "tessera-precache-"));
  try {
    await writeFile(join(root, "sw.js"), 'const PAGES = ["/"];');
    await expect(embedPrecacheList(root)).rejects.toThrow(/PRECACHE/);
    await writeFile(join(empty, "sw.js"), SW);
    await expect(embedPrecacheList(empty)).rejects.toThrow(/index\.html/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

test("the worker source has the line the build fills in, and lists no page by hand", async () => {
  const source = await readFile(join(__dirname, "..", "..", "..", "public", "sw.js"), "utf8");
  expect(source).toMatch(/^const PRECACHE = \[\];/m);
  expect(source).not.toMatch(/"\/study\/"/);
});
