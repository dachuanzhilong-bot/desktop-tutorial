import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { decodeChunk, parseManifest } from "../solution/decode";
import type { Manifest, NodeSolution } from "../solution/types";

const DIR = path.resolve(__dirname, "../../../public/solutions/cash6max-100bb");

export function loadManifest(): Manifest {
  return parseManifest(JSON.parse(gunzipSync(readFileSync(path.join(DIR, "manifest.json.gz"))).toString("utf8")));
}

const cache = new Map<number, Map<number, NodeSolution>>();
export function loadNode(m: Manifest, id: number): NodeSolution {
  const chunk = m.nodes[id].chunk;
  let map = cache.get(chunk);
  if (!map) {
    map = decodeChunk(new Uint8Array(gunzipSync(readFileSync(path.join(DIR, `chunk-${chunk}.bin.gz`)))));
    cache.set(chunk, map);
  }
  return map.get(id)!;
}

/** follow a path such as "FFFRF" (F fold, C call, R raise/all-in) from the root */
export function walk(m: Manifest, p: string): number {
  let id = 0;
  for (const ch of p) {
    const n = m.nodes[id];
    const want = ch === "F" ? [0] : ch === "C" ? [1] : [2, 3];
    const a = n.actions.find((x) => want.includes(x.kind));
    if (!a || a.child < 0) throw new Error(`cannot follow ${p} at ${id}`);
    id = a.child;
  }
  return id;
}

/** combo-weighted action mix of the acting range */
export function mix(sol: NodeSolution): number[] {
  const K = 169;
  const out = new Array(sol.na).fill(0);
  let tot = 0;
  for (let h = 0; h < K; h++) {
    const row = Math.floor(h / 13);
    const col = h % 13;
    const combos = row === col ? 6 : row < col ? 4 : 12;
    const w = combos * sol.weight[h];
    tot += w;
    for (let a = 0; a < sol.na; a++) out[a] += w * sol.freq[a * K + h];
  }
  return out.map((x) => x / tot);
}

/** the solution of another stack depth (needs `npm run solutions:pack` to have packed it) */
export function loadManifestFor(depth: number): Manifest {
  const dir = path.resolve(__dirname, `../../../public/solutions/cash6max-${depth}bb`);
  return parseManifest(JSON.parse(gunzipSync(readFileSync(path.join(dir, "manifest.json.gz"))).toString("utf8")));
}

const depthCache = new Map<string, Map<number, NodeSolution>>();
export function loadNodeFor(depth: number, m: Manifest, id: number): NodeSolution {
  const chunk = m.nodes[id].chunk;
  const key = `${depth}:${chunk}`;
  let map = depthCache.get(key);
  if (!map) {
    const dir = path.resolve(__dirname, `../../../public/solutions/cash6max-${depth}bb`);
    map = decodeChunk(new Uint8Array(gunzipSync(readFileSync(path.join(dir, `chunk-${chunk}.bin.gz`)))));
    depthCache.set(key, map);
  }
  return map.get(id)!;
}
