import type { Manifest, NodeSolution, SpotType } from "../solution/types";
import { spotType } from "../solution/tree";
import { HandFilterId, matchesFilter, NUM_CLASSES, comboCount } from "../poker/hands";
import { weightedPick } from "../util/rng";
import { mixedness, priorityWeight, SrsItem } from "./srs";

export interface PracticeFilter {
  /** hero seats (empty = any) */
  seats: number[];
  spots: SpotType[]; // empty = any
  hands: HandFilterId;
  /** only hands the solution actually mixes */
  mixedOnly: boolean;
  /** weight deep / rare lines up (0 = natural frequency, 1 = flat) */
  flatten: number;
}

export const DEFAULT_FILTER: PracticeFilter = { seats: [], spots: [], hands: "all", mixedOnly: false, flatten: 0.55 };

const MIN_WEIGHT = 0.02; // a hand must be in the range at least this often

/** candidate nodes (cached per manifest + filter key) */
export function candidateNodes(m: Manifest, f: PracticeFilter): number[] {
  const out: number[] = [];
  for (const n of m.nodes) {
    if (n.reach < 1e-5) continue;
    // a forced move (e.g. folding behind an all-in and a call) is not a decision
    if (n.actions.length < 2) continue;
    if (f.seats.length && !f.seats.includes(n.actor)) continue;
    if (f.spots.length && !f.spots.includes(spotType(m, n.id))) continue;
    out.push(n.id);
  }
  return out;
}

export function pickNode(m: Manifest, nodes: number[], f: PracticeFilter, rnd: () => number): number {
  const w = nodes.map((id) => Math.pow(m.nodes[id].reach, 1 - f.flatten));
  return nodes[weightedPick(w, rnd)];
}

/** `itemOf`: the spaced-repetition item of a hand class at this decision (looked up by position, see SrsIndex.find) */
export function pickHand(sol: NodeSolution, f: PracticeFilter, rnd: () => number, itemOf: (hand: number) => SrsItem | undefined, now: number): number {
  const w = new Float64Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    if (sol.weight[h] < MIN_WEIGHT || !matchesFilter(h, f.hands)) continue;
    const fr = new Float32Array(sol.na);
    for (let a = 0; a < sol.na; a++) fr[a] = sol.freq[a * NUM_CLASSES + h];
    const mx = mixedness(fr);
    if (f.mixedOnly && mx < 0.12) continue;
    w[h] = comboCount(h) * sol.weight[h] * priorityWeight({ item: itemOf(h), now, mixedness: mx, mixedBoost: true });
  }
  return weightedPick(w, rnd);
}
