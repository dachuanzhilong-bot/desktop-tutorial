/** the Solve screen's unsaved inputs survive navigation (e.g. a trip to the Range Builder) in localStorage */
import { bool, int, isObj, LocalSchema, num, pick, readLocal, str, writeLocal } from "../storage/local";
import { DEFAULT_SOLVE } from "./config";
import type { SolveConfig } from "./config";

export const SOLVE_ACCURACY = ["draft", "std", "high"] as const;
export type SolveAccuracy = (typeof SOLVE_ACCURACY)[number];

export interface SolveDraft {
  board: number[];
  oopText: string;
  ipText: string;
  oopName: string;
  ipName: string;
  pot: number;
  stack: number;
  cfg: SolveConfig;
  acc: SolveAccuracy;
  iterations: number;
  target: number;
}

const sizes = (v: unknown, fallback: number[]): number[] => {
  if (!Array.isArray(v)) return fallback;
  const out = v.filter((x): x is number => typeof x === "number" && x > 0 && x <= 10).slice(0, 4);
  return out.length || v.length === 0 ? out : fallback;
};
const triple = <T,>(v: unknown, each: (x: unknown, i: number) => T): [T, T, T] => {
  const a = Array.isArray(v) ? v : [];
  return [each(a[0], 0), each(a[1], 1), each(a[2], 2)];
};

export function sanitizeConfig(v: unknown): SolveConfig {
  const c = isObj(v) ? v : {};
  const D = DEFAULT_SOLVE;
  return {
    pot: num(c.pot, D.pot, 0.5, 10_000),
    stack: num(c.stack, D.stack, 0, 10_000),
    bets: triple(c.bets, (x, i) => sizes(x, D.bets[i])),
    raiseMult: num(c.raiseMult, D.raiseMult, 1.5, 10),
    allinRatio: num(c.allinRatio, D.allinRatio, 0, 1),
    allowAllin: bool(c.allowAllin, D.allowAllin),
    raiseSizes: triple(c.raiseSizes, (x, i) => bool(x, D.raiseSizes[i])),
    turnCards: int(c.turnCards, D.turnCards, 1, 48),
    riverCards: int(c.riverCards, D.riverCards, 1, 48),
    flopRunouts: int(c.flopRunouts, D.flopRunouts, 1, 2000),
    seed: int(c.seed, D.seed, 0, 2 ** 31),
  };
}

const validBoard = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length >= 3 && v.length <= 5 && v.every((c) => Number.isInteger(c) && c >= 0 && c < 52) && new Set(v).size === v.length;

/**
 * Solve draft schema history
 *   1: unversioned partial object (Phase 4–8)
 *   2: `_v`, all fields validated; a missing field is simply left out (the screen keeps its default)
 */
export const SOLVE_DRAFT_SCHEMA: LocalSchema<Partial<SolveDraft>> = {
  key: "tessera.solveDraft.v1",
  version: 2,
  migrations: { 1: (d) => d },
  sanitize: (d) => {
    const out: Partial<SolveDraft> = {};
    if (validBoard(d.board)) out.board = d.board;
    if (typeof d.oopText === "string") out.oopText = str(d.oopText, "");
    if (typeof d.ipText === "string") out.ipText = str(d.ipText, "");
    if (typeof d.oopName === "string") out.oopName = str(d.oopName, "", 40);
    if (typeof d.ipName === "string") out.ipName = str(d.ipName, "", 40);
    const pot = num(d.pot, 0, 0, 10_000);
    if (pot > 0) out.pot = pot;
    const stack = num(d.stack, 0, 0, 10_000);
    if (stack > 0) out.stack = stack;
    if (isObj(d.cfg)) out.cfg = sanitizeConfig(d.cfg);
    if (typeof d.acc === "string") out.acc = pick(d.acc, SOLVE_ACCURACY, "std");
    const it = int(d.iterations, 0, 1, 100_000);
    if (it > 0) out.iterations = it;
    const target = num(d.target, 0, 0, 100);
    if (target > 0) out.target = target;
    return out;
  },
};

export function loadDraft(): Partial<SolveDraft> {
  return readLocal(SOLVE_DRAFT_SCHEMA) ?? {};
}

export function saveDraft(patch: Partial<SolveDraft>) {
  writeLocal(SOLVE_DRAFT_SCHEMA, { ...loadDraft(), ...patch });
}
