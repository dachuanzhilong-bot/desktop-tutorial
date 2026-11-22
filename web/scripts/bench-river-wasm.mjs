// Times the solve of one river tree with the WebAssembly solver in Node (REFACTOR_PLAN 3-3-4): what the device does
// for every river card in plan B (docs/14 §3). Each run is a fresh session of `--iters` iterations, the average
// restarted half-way (as `gen_postflop`); `--warmup` untimed iterations come first. Prints every run, then the median
// and the fastest as one JSON line. `--update alt-dcfr` (or `alt-cfr+`) solves as the device does since docs/14 §18
// (`tsr_set_update`, no average restart for alt-dcfr); the default is sim-cfr+.
//
//   # the SRP BB / BTN starting ranges (2 x 1,326 f32) come from the native tool:
//   (cd ../solver && ./target/release/measure_exploit --bench-river "Ah 8d 7c 2s 3d" --pre out/pre/cash6max-100bb \
//       --runs 1 --iters 10 --ranges-out out/srp-ranges.bin)
//   node scripts/bench-river-wasm.mjs --ranges ../solver/out/srp-ranges.bin [--board "Ah 8d 7c 2s 3d"] \
//       [--iters 3000] [--runs 7] [--warmup 500] [--wasm public/wasm/tessera_solver.wasm] [--pot 5.5] [--stack 97.5] \
//       [--update sim-cfr+|alt-cfr+|alt-dcfr]
//
// Without `--ranges` both players hold every combo off the board (wider than a real river range: slower).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NC = 1326;
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const here = dirname(fileURLToPath(import.meta.url));
const wasmPath = opt("--wasm", join(here, "../public/wasm/tessera_solver.wasm"));
const boardText = opt("--board", "Ah 8d 7c 2s 3d");
const iters = Number(opt("--iters", 3000));
const runs = Math.max(1, Number(opt("--runs", 7)));
const warmup = Number(opt("--warmup", 500));
const pot = Number(opt("--pot", 5.5));
const stack = Number(opt("--stack", 97.5));
const rangesPath = opt("--ranges", "");
const update = opt("--update", "sim-cfr+");
const UPDATE_CODE = { "sim-cfr+": 0, "alt-cfr+": 1, "alt-dcfr": 2 }; // lib/solve/protocol.ts
if (!(update in UPDATE_CODE)) throw new Error(`--update ${update}: sim-cfr+, alt-cfr+ or alt-dcfr`);

const card = (s) => "23456789TJQKA".indexOf(s[0]) * 4 + "cdhs".indexOf(s[1]);
const board = boardText.trim().split(/\s+/).map(card);
if (board.length !== 5 || board.some((c) => c < 0)) throw new Error(`--board must be 5 cards, got "${boardText}"`);

// the combo order of the solver (solver/src/postflop.rs `ComboTable`): a < b, a-major
const combos = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) combos.push([a, b]);
let r0, r1;
if (rangesPath) {
  const buf = readFileSync(rangesPath);
  if (buf.byteLength !== 2 * NC * 4) throw new Error(`${rangesPath}: expected ${2 * NC * 4} bytes`);
  const all = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  [r0, r1] = [all.slice(0, NC), all.slice(NC)];
} else {
  r0 = new Float32Array(NC).fill(1);
  r1 = new Float32Array(NC).fill(1);
}
// what lib/solve/config.ts `solverRanges` does: no combo that collides with the board
for (let h = 0; h < NC; h++) if (board.includes(combos[h][0]) || board.includes(combos[h][1])) r0[h] = r1[h] = 0;

// gen_postflop's default tree (solver/src/postflop.rs `Config::default`); only the river part is used
const cfg = [pot, stack, 3, 0.67, 1, 1, 0, 0, 6, 2, 120, 7, 2, 0.33, 0.75, 1, 0.66, 2, 0.5, 1.0];

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const e = instance.exports;
const put32 = (arr) => {
  const p = e.tsr_alloc_f32(arr.length);
  new Float32Array(e.memory.buffer, p, arr.length).set(arr);
  return p;
};
function create() {
  const c = put32(cfg);
  const b = e.tsr_alloc(5);
  new Uint8Array(e.memory.buffer, b, 5).set(board);
  const p0 = put32(r0);
  const p1 = put32(r1);
  const h = e.tsr_create(c, cfg.length, b, 5, p0, p1);
  e.tsr_free_f32(c, cfg.length);
  e.tsr_free(b, 5);
  e.tsr_free_f32(p0, NC);
  e.tsr_free_f32(p1, NC);
  if (h < 0) throw new Error(`tsr_create failed (${h})`);
  if (update !== "sim-cfr+" && e.tsr_set_update(h, UPDATE_CODE[update]) !== 0) throw new Error(`tsr_set_update ${update} refused`);
  return h;
}

const support = (r) => r.reduce((n, x) => n + (x !== 0 ? 1 : 0), 0);
const h0 = create();
console.error(`${wasmPath}\n${boardText}: ${e.tsr_node_count(h0)} nodes, ranges OOP ${support(r0)} / IP ${support(r1)} combos${rangesPath ? "" : " (every combo)"}`);
if (warmup > 0) e.tsr_run(h0, warmup);
e.tsr_destroy(h0);

const ms = [];
const after = []; // one exploitability measure + one export (what the app does once a solve is done)
for (let r = 0; r < runs; r++) {
  const h = create();
  const t = performance.now();
  if (update === "alt-dcfr") {
    e.tsr_run(h, iters);
  } else {
    e.tsr_run(h, Math.floor(iters / 2));
    e.tsr_reset_average(h);
    e.tsr_run(h, iters - Math.floor(iters / 2));
  }
  const el = performance.now() - t;
  const ex = e.tsr_exploit_pct(h);
  const len = e.tsr_export(h, 0.004);
  const el2 = performance.now() - t - el;
  e.tsr_destroy(h);
  ms.push(el);
  after.push(el2);
  console.error(`run ${r + 1}: ${iters} iterations in ${el.toFixed(1)} ms (${(el / iters).toFixed(4)} ms/iteration), exploitability ${ex.toFixed(3)}% of the pot; measure + export (${len} bytes) ${el2.toFixed(1)} ms`);
}
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const med = median(ms);
console.log(JSON.stringify({ board: boardText, wasm: wasmPath, update, iters, runs, medianMs: +med.toFixed(1), minMs: +Math.min(...ms).toFixed(1), medianMsPerIter: +(med / iters).toFixed(4), measureExportMs: +median(after).toFixed(1) }));
