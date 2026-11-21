// Packs the solver's postflop output (raw <scenario>/<n>.bin + index.json) into <dst>/<scenario>/<n>.bin.gz and
// <dst>/index.json with the build IDs of the packed files (scripts/build-id.mjs). `pack-solutions.mjs` packs the
// postflop data with it; the data-pack workflow (REFACTOR_PLAN 4-5) packs a PC's output with it alone.
//
//   node scripts/pack-postflop.mjs <solver postflop dir> [public/postflop]
import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stampPostflop } from "./build-id.mjs";

/** packs `src` into `dst`; returns the number of files and their gzip bytes */
export function packPostflop(src, dst) {
  mkdirSync(dst, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const sc of readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    mkdirSync(join(dst, sc.name), { recursive: true });
    for (const f of readdirSync(join(src, sc.name)).filter((x) => x.endsWith(".bin"))) {
      const gz = gzipSync(readFileSync(join(src, sc.name, f)), { level: 9 });
      writeFileSync(join(dst, sc.name, f + ".gz"), gz);
      files++;
      bytes += gz.length;
    }
  }
  writeFileSync(join(dst, "index.json"), readFileSync(join(src, "index.json")));
  stampPostflop(dst); // the IDs are those of the packed bytes: they are made here, not by the solver or the merge
  return { files, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [src, dst = "public/postflop"] = process.argv.slice(2);
  if (!src) {
    console.error("usage: node scripts/pack-postflop.mjs <solver postflop dir> [public/postflop]");
    process.exit(1);
  }
  const { files, bytes } = packPostflop(resolve(src), resolve(dst));
  console.log(`packed postflop: ${files} files, ${(bytes / 1e6).toFixed(2)} MB gzip`);
}
