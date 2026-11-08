import { ALL_CLASSES, NUM_CLASSES } from "../poker/hands";
import type { NodeSolution } from "../solution/types";

const K = NUM_CLASSES;

/** combos of the acting range (weighted by how often the class reaches the node) */
export function rangeCombos(sol: NodeSolution): number {
  let s = 0;
  for (const c of ALL_CLASSES) s += c.combos * sol.weight[c.id];
  return s;
}

/** fraction of all 1326 starting hands that reach the node */
export const rangeWidth = (sol: NodeSolution) => rangeCombos(sol) / 1326;

/** combo-weighted action mix of the acting range (sums to 1) */
export function actionMix(sol: NodeSolution): number[] {
  const mix = new Array(sol.na).fill(0);
  let tot = 0;
  for (const c of ALL_CLASSES) {
    const w = c.combos * sol.weight[c.id];
    tot += w;
    for (let a = 0; a < sol.na; a++) mix[a] += w * sol.freq[a * K + c.id];
  }
  return tot > 0 ? mix.map((m) => m / tot) : mix;
}

export function actionCombos(sol: NodeSolution): number[] {
  const out = new Array(sol.na).fill(0);
  for (const c of ALL_CLASSES) for (let a = 0; a < sol.na; a++) out[a] += c.combos * sol.weight[c.id] * sol.freq[a * K + c.id];
  return out;
}

/** combos per equity bucket (default 10 buckets of 10 %), plus the range's mean equity */
export function equityBins(sol: NodeSolution, nBins = 10): { bins: number[]; mean: number } {
  const bins = new Array(nBins).fill(0);
  let tot = 0;
  let acc = 0;
  for (const c of ALL_CLASSES) {
    const w = c.combos * sol.weight[c.id];
    if (w <= 0) continue;
    const e = sol.equity[c.id];
    bins[Math.min(nBins - 1, Math.floor(e * nBins))] += w;
    tot += w;
    acc += w * e;
  }
  return { bins, mean: tot > 0 ? acc / tot : 0 };
}

/** the range that takes action `a` (weight * frequency per class) */
export function actionRange(sol: NodeSolution, a: number): Float32Array {
  const out = new Float32Array(K);
  for (let h = 0; h < K; h++) out[h] = sol.weight[h] * sol.freq[a * K + h];
  return out;
}

export function rangeCombosOf(range: ArrayLike<number>): number {
  let s = 0;
  for (const c of ALL_CLASSES) s += c.combos * range[c.id];
  return s;
}

/** EV of the best action for a class */
export function bestEv(sol: NodeSolution, h: number): { a: number; ev: number } {
  let a = 0;
  for (let i = 1; i < sol.na; i++) if (sol.ev[i * K + h] > sol.ev[a * K + h]) a = i;
  return { a, ev: sol.ev[a * K + h] };
}

export function handActionStats(sol: NodeSolution, h: number) {
  return Array.from({ length: sol.na }, (_, a) => ({ freq: sol.freq[a * K + h], ev: sol.ev[a * K + h] }));
}
