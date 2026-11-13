/**
 * The Solve screen's inputs as a reducer (components/solve/useSolveForm.ts holds it): board, ranges, pot / stack,
 * bet sizes and accuracy. Pure, so the tests can walk through it; the draft in localStorage (draft.ts) is read and
 * written from this state.
 */
import { parseBoard } from "../postflop/combos";
import { DEFAULT_SOLVE } from "./config";
import type { SolveConfig } from "./config";
import type { SolveAccuracy, SolveDraft } from "./draft";
import type { SavedSolve } from "../storage/types";

/** iterations per accuracy level for a solve that starts on the [flop, turn, river] */
export const ITERS: Record<SolveAccuracy, [number, number, number]> = { draft: [60, 150, 300], std: [250, 600, 1000], high: [600, 2000, 4000] };
export const TARGET: Record<SolveAccuracy, number> = { draft: 2, std: 1, high: 0.5 };
export const iterFor = (acc: SolveAccuracy, boardLen: number) => ITERS[acc][Math.max(0, Math.min(2, boardLen - 3))];

export const DEFAULT_BOARD = parseBoard("Ks 7d 2c");

export interface SolveForm {
  board: number[];
  oopText: string;
  ipText: string;
  oopName: string;
  ipName: string;
  /** as typed (the inputs are text fields) */
  pot: string;
  stack: string;
  cfg: SolveConfig;
  acc: SolveAccuracy;
  iterations: number;
  target: number;
  /** the name a result is saved under (not part of the draft) */
  title: string;
  /** the board length `iterations` was last set for: a solve that starts on another street needs another count */
  itersForLen: number;
}

export const INITIAL_FORM: SolveForm = {
  board: DEFAULT_BOARD,
  oopText: "",
  ipText: "",
  oopName: "BB",
  ipName: "BTN",
  pot: "5.5",
  stack: "97.5",
  cfg: DEFAULT_SOLVE,
  acc: "std",
  iterations: iterFor("std", DEFAULT_BOARD.length),
  target: TARGET.std,
  title: "",
  itersForLen: DEFAULT_BOARD.length,
};

/** what a field edit may change directly */
export type FormPatch = Partial<Pick<SolveForm, "board" | "oopText" | "ipText" | "oopName" | "ipName" | "pot" | "stack" | "cfg" | "iterations" | "target" | "title">>;

export type FormAction =
  | { type: "set"; patch: FormPatch }
  /** an accuracy preset: its iteration count (for the first street solved) and target */
  | { type: "accuracy"; acc: SolveAccuracy }
  /** the draft read back from localStorage: a missing field keeps what the screen has */
  | { type: "restore"; draft: Partial<SolveDraft> }
  /** a saved solve opened again: its board, ranges, sizes and name */
  | { type: "load"; solve: SavedSolve }
  /** ranges from the preflop solution: only into a field that is still empty */
  | { type: "fillRanges"; oop?: string; ip?: string };

function apply(s: SolveForm, a: FormAction): SolveForm {
  switch (a.type) {
    case "set":
      return { ...s, ...a.patch };
    case "accuracy":
      return { ...s, acc: a.acc, iterations: iterFor(a.acc, s.board.length), target: TARGET[a.acc] };
    case "restore": {
      const d = a.draft;
      return {
        ...s,
        ...(d.board && { board: d.board }),
        ...(d.oopText && { oopText: d.oopText }),
        ...(d.ipText && { ipText: d.ipText }),
        ...(d.oopName !== undefined && { oopName: d.oopName }),
        ...(d.ipName !== undefined && { ipName: d.ipName }),
        ...(d.pot && { pot: String(d.pot) }),
        ...(d.stack && { stack: String(d.stack) }),
        ...(d.cfg && { cfg: d.cfg }),
        ...(d.acc && { acc: d.acc }),
        ...(d.iterations && { iterations: d.iterations }),
        ...(d.target && { target: d.target }),
      };
    }
    case "load": {
      const cfg = a.solve.cfg as SolveConfig;
      return { ...s, board: a.solve.board, cfg, pot: String(cfg.pot), stack: String(cfg.stack), oopText: a.solve.oopText, ipText: a.solve.ipText, oopName: a.solve.oopName, ipName: a.solve.ipName, title: a.solve.title };
    }
    case "fillRanges":
      return { ...s, oopText: s.oopText || a.oop || "", ipText: s.ipText || a.ip || "" };
  }
}

export function formReducer(s: SolveForm, a: FormAction): SolveForm {
  const next = apply(s, a);
  // a different first street needs a different iteration count, whatever changed the board
  if (next.board.length !== next.itersForLen) return { ...next, itersForLen: next.board.length, iterations: iterFor(next.acc, next.board.length) };
  return next;
}

/** pot and stack as numbers (0 when the field does not hold one) */
export const potOf = (s: SolveForm) => Number(s.pot) || 0;
export const stackOf = (s: SolveForm) => Number(s.stack) || 0;

/** what is kept in localStorage between visits (draft.ts) */
export function draftOf(s: SolveForm): SolveDraft {
  return { board: s.board, oopText: s.oopText, ipText: s.ipText, oopName: s.oopName, ipName: s.ipName, pot: potOf(s), stack: stackOf(s), cfg: s.cfg, acc: s.acc, iterations: s.iterations, target: s.target };
}

/** the solver's configuration: the sizes with the pot and stack of the fields */
export const fullConfig = (s: SolveForm): SolveConfig => ({ ...s.cfg, pot: potOf(s), stack: stackOf(s) });
