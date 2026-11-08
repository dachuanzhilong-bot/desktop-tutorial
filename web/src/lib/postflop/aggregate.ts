import { NUM_CLASSES, classInfo } from "../poker/hands";
import type { NodeSolution } from "../solution/types";
import { COMBOS_OF_CLASS, NC } from "./combos";
import type { DenseNode } from "./decode";

/**
 * Collapse the 1,326 combos of a node into the 169 chart cells (so the same chart components work).
 * weight = mean range weight over *all* combos of the class (combos blocked by the board count as 0);
 * freq / ev / equity = averages weighted by each combo's range weight.
 */
export function toClassSolution(id: number, d: DenseNode): NodeSolution {
  const na = d.na;
  const weight = new Float32Array(NUM_CLASSES);
  const equity = new Float32Array(NUM_CLASSES);
  const freq = new Float32Array(na * NUM_CLASSES);
  const ev = new Float32Array(na * NUM_CLASSES);
  for (let c = 0; c < NUM_CLASSES; c++) {
    const list = COMBOS_OF_CLASS[c];
    let wsum = 0;
    for (const h of list) wsum += d.weight[h];
    weight[c] = wsum / classInfo(c).combos;
    if (wsum <= 1e-9) {
      equity[c] = 0.5;
      for (let a = 0; a < na; a++) freq[a * NUM_CLASSES + c] = 1 / na;
      continue;
    }
    let eq = 0;
    for (const h of list) eq += d.weight[h] * d.eq[h];
    equity[c] = eq / wsum;
    for (let a = 0; a < na; a++) {
      let f = 0;
      let e = 0;
      for (const h of list) {
        f += d.weight[h] * d.freq[a * NC + h];
        e += d.weight[h] * d.ev[a * NC + h];
      }
      freq[a * NUM_CLASSES + c] = f / wsum;
      ev[a * NUM_CLASSES + c] = e / wsum;
    }
  }
  return { id, na, weight, equity, freq, ev, eqr: null };
}

/** combo weighted action mix of the whole range at a node */
export function mixOf(d: DenseNode): number[] {
  const mix = new Array(d.na).fill(0);
  let tot = 0;
  for (let h = 0; h < NC; h++) {
    const w = d.weight[h];
    if (!w) continue;
    tot += w;
    for (let a = 0; a < d.na; a++) mix[a] += w * d.freq[a * NC + h];
  }
  return tot > 0 ? mix.map((m) => m / tot) : mix;
}

export function rangeCombos(d: DenseNode): number {
  let s = 0;
  for (let h = 0; h < NC; h++) s += d.weight[h];
  return s;
}
