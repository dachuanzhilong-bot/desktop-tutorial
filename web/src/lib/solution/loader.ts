import { decodeChunk, gunzip, parseManifest } from "./decode";
import type { Manifest, NodeSolution } from "./types";

export const DEFAULT_SOLUTION = "cash6max-100bb";

export class SolutionStore {
  manifest: Manifest;
  private chunks = new Map<number, Promise<Map<number, NodeSolution>>>();
  private base: string;

  constructor(manifest: Manifest, base: string) {
    this.manifest = manifest;
    this.base = base;
  }

  static async open(id: string = DEFAULT_SOLUTION, base = "/solutions"): Promise<SolutionStore> {
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
        .then(decodeChunk);
      p.catch(() => this.chunks.delete(chunk));
      this.chunks.set(chunk, p);
    }
    return p;
  }

  async node(id: number): Promise<NodeSolution> {
    const meta = this.manifest.nodes[id];
    const map = await this.loadChunk(meta.chunk);
    const sol = map.get(id);
    if (!sol) throw new Error(`node ${id} missing in chunk ${meta.chunk}`);
    return sol;
  }
}
