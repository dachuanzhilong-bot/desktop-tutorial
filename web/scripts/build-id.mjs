// Build IDs of the packed solution data: the first 12 hex digits of the SHA-256 of the packed (.gz) bytes.
//
//   preflop:  one ID per solution  = all files of public/solutions/<id>/, concatenated in the order of their names
//   postflop: one ID per scenario x flop = the one file public/postflop/<scenario>/<n>.bin.gz
//
// The IDs go into the two index.json files as `build`; the loaders and the service worker fetch every data file
// with ?b=<build>, so a file of one generation is never mixed with another (REFACTOR_PLAN step 1-1).
// They depend on the bytes only – not on dates, and not on the order the file system lists the files in.
//
// Used by pack-solutions.mjs after packing. Run on its own, it stamps the data that is already packed,
// without the solver output:
//
//   node scripts/build-id.mjs            (npm run solutions:stamp)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BUILD_LENGTH = 12;

/** build ID of a list of files, in the order given */
export function buildOf(files) {
  const h = createHash("sha256");
  for (const f of files) h.update(readFileSync(f));
  return h.digest("hex").slice(0, BUILD_LENGTH);
}

/** names in one fixed order (by UTF-16 code unit: no locale, no file system order) */
const sorted = (names) => [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** build ID of one packed preflop solution directory */
export const preflopBuild = (dir) => buildOf(sorted(readdirSync(dir)).map((f) => join(dir, f)));

/**
 * adds `build` to every solution of public/solutions/index.json; everything else stays as it is.
 * `build` is written last in each entry (after the catalog fields of pack-solutions.mjs), so stamping again
 * writes the same bytes.
 */
export function stampSolutions(dir) {
  const file = join(dir, "index.json");
  const index = JSON.parse(readFileSync(file, "utf8"));
  for (const s of index.solutions) {
    delete s.build;
    s.build = preflopBuild(join(dir, s.id));
  }
  writeFileSync(file, JSON.stringify(index));
  return index;
}

/** adds `build` ("<scenario>/<flop>" -> ID, the keys of `stats`) to public/postflop/index.json */
export function stampPostflop(dir) {
  const file = join(dir, "index.json");
  const index = JSON.parse(readFileSync(file, "utf8"));
  const build = {};
  for (const sc of index.scenarios) for (let i = 0; i < index.flops.length; i++) build[`${sc.id}/${i}`] = buildOf([join(dir, sc.id, `${i}.bin.gz`)]);
  delete index.build; // written last, after the keys that were there before
  index.build = build;
  writeFileSync(file, JSON.stringify(index));
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pub = resolve(process.argv[2] ?? "public");
  const pre = stampSolutions(join(pub, "solutions"));
  for (const s of pre.solutions) console.log(`${s.id}: ${s.build}`);
  if (existsSync(join(pub, "postflop", "index.json"))) console.log(`postflop: ${Object.keys(stampPostflop(join(pub, "postflop")).build).length} flop files stamped`);
}
