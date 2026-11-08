// Packs solver output (raw .bin + manifest.json) into gzip files under public/solutions/<id>/
// and writes public/solutions/index.json (used by the service worker to precache for offline use).
//
//   node scripts/pack-solutions.mjs [../solver/out]
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const src = resolve(process.argv[2] ?? "../solver/out");
const dst = resolve("public/solutions");
mkdirSync(dst, { recursive: true });

const index = { version: 1, solutions: [] };
for (const id of readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  const dir = join(src, id);
  if (!existsSync(join(dir, "manifest.json"))) continue;
  const out = join(dst, id);
  mkdirSync(out, { recursive: true });
  const files = [];
  for (const f of readdirSync(dir)) {
    const raw = readFileSync(join(dir, f));
    const name = f + ".gz";
    writeFileSync(join(out, name), gzipSync(raw, { level: 9 }));
    files.push(`/solutions/${id}/${name}`);
  }
  index.solutions.push({ id, files });
  console.log(`packed ${id}: ${files.length} files`);
}
writeFileSync(join(dst, "index.json"), JSON.stringify(index));
