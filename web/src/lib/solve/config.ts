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
  bets: [[0.33, 0.75], [0.66], [0.5, 1]],
  raiseMult: 3,
  allinRatio: 0.67,
  allowAllin: true,
  raiseSizes: [true, false, false],
  turnCards: 6,
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

/** rough tree size / cost estimate shown before the solve starts */
export function costHint(boardLen: number, c: SolveConfig): { level: "fast" | "medium" | "slow"; msPerIter: number } {
  // measured with the WASM build: river 0.7 ms, turn (river x4) 10 ms, flop (turn x4, river x1) 157 ms per iteration
  const base = boardLen >= 5 ? 0.7 : boardLen === 4 ? 2.5 * c.riverCards : 40 * c.turnCards * (c.riverCards / 2 + 0.5) * 0.4;
  const bets = c.bets[Math.min(2, boardLen - 3)].length + 1;
  const ms = base * (bets / 3);
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
