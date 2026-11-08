import type { Range169 } from "../ranges/range";
import { expandToCombos } from "../ranges/range";

/** what the Solve screen lets the user choose; mirrors solver/src/ffi.rs `config_from_f32` */
export interface SolveConfig {
  pot: number;
  stack: number;
  /** bet sizes as a fraction of the pot, per street (flop, turn, river) */
  bets: [number[], number[], number[]];
  raiseMult: number;
  allinRatio: number;
  allowAllin: boolean;
  /** may a bet be raised to raiseMult x (otherwise only the all-in raise exists), per street */
  raiseSizes: [boolean, boolean, boolean];
  turnCards: number;
  riverCards: number;
  flopRunouts: number;
  seed: number;
}

export const DEFAULT_SOLVE: SolveConfig = {
  pot: 5.5,
  stack: 97.5,
  // lighter than the shipped solutions (those have two flop sizes and a raise size): a flop solve has to finish in the browser
  bets: [[0.5], [0.66], [0.5, 1]],
  raiseMult: 3,
  allinRatio: 0.67,
  allowAllin: true,
  raiseSizes: [false, false, false],
  turnCards: 4,
  riverCards: 2,
  flopRunouts: 120,
  seed: 7,
};

export function buildConfig(c: SolveConfig): number[] {
  const v = [
    c.pot,
    c.stack,
    c.raiseMult,
    c.allinRatio,
    c.allowAllin ? 1 : 0,
    ...c.raiseSizes.map((x) => (x ? 1 : 0)),
    c.turnCards,
    c.riverCards,
    c.flopRunouts,
    c.seed,
  ];
  for (const street of c.bets) v.push(street.length, ...street);
  return v;
}

/**
 * Rough cost of one iteration, calibrated with the WebAssembly build (see docs/04):
 *   river ~0.6 ms, turn ~6.7 ms (2 sizes on the river), flop ~92 ms (4 turn / 2 river cards, one size per street)
 * It grows with the number of bet options per street and with the sampled cards.
 */
export function costHint(boardLen: number, c: SolveConfig): { level: "fast" | "medium" | "slow"; msPerIter: number } {
  const start = Math.max(0, Math.min(2, boardLen - 3));
  const width = (s: number) => c.bets[s].length + (c.raiseSizes[s] ? 1 : 0) + (c.allowAllin ? 1 : 0);
  const rel = (ref: number, f: number) => Math.pow(f / ref, 1.3);
  const riverTerm = (0.695 + c.riverCards) / 2.695;
  let ms: number;
  if (start === 2) ms = 0.6 * rel(3, width(2));
  else if (start === 1) ms = 6.7 * riverTerm * rel(6, width(1) * width(2));
  else ms = 92.4 * (c.turnCards / 4) * riverTerm * rel(12, width(0) * width(1) * width(2));
  return { level: ms < 8 ? "fast" : ms < 60 ? "medium" : "slow", msPerIter: ms };
}

export interface SolveInput {
  board: number[];
  cfg: SolveConfig;
  /** [out of position, in position] */
  ranges: [Range169, Range169];
}

export function solverRanges(r: [Range169, Range169], board: number[]): [Float32Array, Float32Array] {
  return [maskBoard(expandToCombos(r[0]), board), maskBoard(expandToCombos(r[1]), board)];
}

import { COMBOS } from "../postflop/combos";
function maskBoard(v: Float32Array, board: number[]): Float32Array {
  COMBOS.forEach((c, i) => {
    if (board.includes(c.c1) || board.includes(c.c2)) v[i] = 0;
  });
  return v;
}
