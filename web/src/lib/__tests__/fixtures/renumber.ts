import type { PfFlop } from "../../postflop/decode";
import type { Manifest } from "../../solution/types";

/**
 * The same trees with different node ids, as generating the data again may produce: the root stays 0, the other
 * ids are reversed. Used by the position-key tests (step 1-2) and by the tests of records that carry a key (1-3).
 */

/** the same tree with different node ids (root stays 0, the others are reversed), as a re-generation may produce */
export function renumberManifest(m: Manifest): { m: Manifest; map: (id: number) => number } {
  const n = m.nodes.length;
  const map = (id: number) => (id <= 0 ? id : n - id);
  const nodes = m.nodes.map((x) => ({ ...x, id: map(x.id), parent: map(x.parent), chunk: (x.chunk + 1) % Math.max(1, m.chunks.length), actions: x.actions.map((a) => ({ ...a, child: map(a.child) })) }));
  nodes.sort((a, b) => a.id - b.id);
  return { m: { ...m, nodes }, map };
}
export function renumberFlop(f: PfFlop): { f: PfFlop; map: (id: number) => number } {
  const n = f.nodes.length;
  const map = (id: number) => (id <= 0 ? id : n - id);
  const nodes = f.nodes.map((x) => ({ ...x, id: map(x.id), parent: map(x.parent), edges: x.edges.map((e) => ({ ...e, code: map(e.code) })) }));
  nodes.sort((a, b) => a.id - b.id);
  return { f: { ...f, nodes }, map };
}
