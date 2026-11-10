import { decodeChunk, gunzip, parseManifest } from "./decode";
import { withBase } from "../util/base";
import type { Manifest, NodeSolution } from "./types";

/** effective stack depths (bb) a preflop solution exists for */
export const DEPTHS = [20, 40, 60, 100, 200] as const;
export type Depth = (typeof DEPTHS)[number];
export const DEFAULT_DEPTH: Depth = 100;
export const solutionId = (depth: number) => `cash6max-${depth}bb`;
export const DEFAULT_SOLUTION = solutionId(DEFAULT_DEPTH);

/** the depth whose solution is closest to an effective stack (compared on a log scale: 70bb is nearer 60 than 100) */
export function nearestDepth(stack: number): Depth {
  let best: Depth = DEPTHS[0];
  let d = Infinity;
  for (const x of DEPTHS) {
    const e = Math.abs(Math.log(Math.max(stack, 1) / x));
    if (e < d) {
      d = e;
      best = x;
    }
  }
  return best;
}

/** depth encoded in a solution id such as "cash6max-40bb" (100 when unknown) */
export const depthOf = (id: string | undefined): number => Number(/-(\d+)bb$/.exec(id ?? "")?.[1]) || DEFAULT_DEPTH;

export class SolutionStore {
  manifest: Manifest;
  private chunks = new Map<number, Promise<Map<number, NodeSolution>>>();
  /** chunks that finished decoding, for synchronous reads */
  private decoded = new Map<number, Map<number, NodeSolution>>();
  private base: string;

  constructor(manifest: Manifest, base: string) {
    this.manifest = manifest;
    this.base = base;
  }

  static async open(id: string = DEFAULT_SOLUTION, base = withBase("/solutions")): Promise<SolutionStore> {
    const res = await fetch(`${base}/${id}/manifest.json.gz`);
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const bytes = await gunzip(await res.arrayBuffer());
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(bytes)));
    return new SolutionStore(manifest, `${base}/${id}`);
  }

  private loadChunk(chunk: number) {
    let p = this.chunks.get(chunk);
    if (!p) {
      p = fetch(`${this.base}/chunk-${chunk}.bin.gz`)
        .then((r) => {
          if (!r.ok) throw new Error(`chunk ${chunk} ${r.status}`);
          return r.arrayBuffer();
        })
        .then(gunzip)
        .then(decodeChunk)
        .then((m) => {
          this.decoded.set(chunk, m);
          return m;
        });
      p.catch(() => this.chunks.delete(chunk));
      this.chunks.set(chunk, p);
    }
    return p;
  }

  /** the node's data if its chunk is already decoded, so a screen can render it in its first pass */
  peek(id: number): NodeSolution | null {
    const meta = this.manifest.nodes[id];
    return meta ? (this.decoded.get(meta.chunk)?.get(id) ?? null) : null;
  }

  async node(id: number): Promise<NodeSolution> {
    const meta = this.manifest.nodes[id];
    const map = await this.loadChunk(meta.chunk);
    const sol = map.get(id);
    if (!sol) throw new Error(`node ${id} missing in chunk ${meta.chunk}`);
    return sol;
  }
}
