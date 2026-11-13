import { decodeChunk, gunzip, parseManifest } from "./decode";
import { withBase } from "../util/base";
import type { Manifest, NodeSolution } from "./types";
import { DEFAULT_SOLUTION, solutionBuild } from "./catalog";

// the solution list (depths, ids, build IDs) lives in the catalog, made from public/solutions/index.json
export { DEFAULT_DEPTH, DEFAULT_SOLUTION, DEPTHS, depthOf, nearestDepth, solutionBuild, solutionId } from "./catalog";
export type { Depth } from "./catalog";

/**
 * A data file's URL with its build ID as ?b=<build>. The service worker caches by the whole URL, so a file of one
 * build is never served for another (a new manifest never meets an old chunk).
 */
export const withBuild = (url: string, build: string): string => (build ? `${url}?b=${build}` : url);

export class SolutionStore {
  manifest: Manifest;
  /** which generation of the data this is (see solutionBuild) */
  readonly build: string;
  private chunks = new Map<number, Promise<Map<number, NodeSolution>>>();
  /** chunks that finished decoding, for synchronous reads */
  private decoded = new Map<number, Map<number, NodeSolution>>();
  private base: string;

  constructor(manifest: Manifest, base: string, build = "") {
    this.manifest = manifest;
    this.base = base;
    this.build = build;
  }

  static async open(id: string = DEFAULT_SOLUTION, base = withBase("/solutions")): Promise<SolutionStore> {
    const build = solutionBuild(id);
    const res = await fetch(withBuild(`${base}/${id}/manifest.json.gz`, build));
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const bytes = await gunzip(await res.arrayBuffer());
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(bytes)));
    return new SolutionStore(manifest, `${base}/${id}`, build);
  }

  private loadChunk(chunk: number) {
    let p = this.chunks.get(chunk);
    if (!p) {
      p = fetch(withBuild(`${this.base}/chunk-${chunk}.bin.gz`, this.build))
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
