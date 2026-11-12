// Packs solver output (raw .bin + manifest.json) into gzip files under public/solutions/<id>/
// and writes public/solutions/index.json (used by the service worker to precache for offline use).
// Both index.json files get the build IDs of the packed files (scripts/build-id.mjs).
//
//   node scripts/pack-solutions.mjs [../solver/out]
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { stampPostflop, stampSolutions } from "./build-id.mjs";

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
for (const s of stampSolutions(dst).solutions) console.log(`build ${s.id}: ${s.build}`);

// ---- postflop: out/postflop/<scenario>/<n>.bin  ->  public/postflop/<scenario>/<n>.bin.gz  (+ index.json as is)
const pfSrc = resolve(process.argv[3] ?? "../solver/out/postflop");
if (existsSync(join(pfSrc, "index.json"))) {
  const pfDst = resolve("public/postflop");
  mkdirSync(pfDst, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const sc of readdirSync(pfSrc, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    mkdirSync(join(pfDst, sc.name), { recursive: true });
    for (const f of readdirSync(join(pfSrc, sc.name)).filter((x) => x.endsWith(".bin"))) {
      const gz = gzipSync(readFileSync(join(pfSrc, sc.name, f)), { level: 9 });
      writeFileSync(join(pfDst, sc.name, f + ".gz"), gz);
      files++;
      bytes += gz.length;
    }
  }
  writeFileSync(join(pfDst, "index.json"), readFileSync(join(pfSrc, "index.json")));
  stampPostflop(pfDst); // the IDs are those of the packed bytes: they are made here, not by the solver or the merge
  console.log(`packed postflop: ${files} files, ${(bytes / 1e6).toFixed(2)} MB gzip`);
}
