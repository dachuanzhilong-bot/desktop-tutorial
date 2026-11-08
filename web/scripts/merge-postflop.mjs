// Merges extra postflop output directories (made with `gen_postflop --from-flop` / another `--scenario`)
// into one directory, so that `npm run solutions:pack` packs everything.
//
//   node scripts/merge-postflop.mjs ../solver/out/postflop ../solver/out/postflop_ext ../solver/out/postflop_co
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [baseArg, ...extras] = process.argv.slice(2);
if (!baseArg || !extras.length) {
  console.error("usage: node scripts/merge-postflop.mjs <base dir> <extra dir>...");
  process.exit(1);
}
const base = resolve(baseArg);
const idx = JSON.parse(readFileSync(join(base, "index.json"), "utf8"));
for (const dir of extras.map((d) => resolve(d))) {
  const ex = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  // flop numbers are indices into one fixed list: the lists must agree where they overlap
  const n = Math.min(idx.flops.length, ex.flops.length);
  for (let i = 0; i < n; i++) if (idx.flops[i] !== ex.flops[i]) throw new Error(`flop ${i} differs: ${idx.flops[i]} vs ${ex.flops[i]}`);
  if (ex.flops.length > idx.flops.length) idx.flops = ex.flops;
  for (const sc of ex.scenarios) {
    const at = idx.scenarios.findIndex((s) => s.id === sc.id);
    if (at < 0) idx.scenarios.push(sc);
  }
  Object.assign(idx.stats, ex.stats);
  for (const d of readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    mkdirSync(join(base, d.name), { recursive: true });
    for (const f of readdirSync(join(dir, d.name)).filter((x) => x.endsWith(".bin"))) copyFileSync(join(dir, d.name, f), join(base, d.name, f));
  }
  console.log(`merged ${dir}`);
}
// every scenario must have a file for every flop
for (const sc of idx.scenarios) for (let i = 0; i < idx.flops.length; i++) if (!existsSync(join(base, sc.id, `${i}.bin`))) throw new Error(`missing ${sc.id}/${i}.bin`);
writeFileSync(join(base, "index.json"), JSON.stringify(idx));
console.log(`${idx.scenarios.length} scenarios x ${idx.flops.length} flops`);
