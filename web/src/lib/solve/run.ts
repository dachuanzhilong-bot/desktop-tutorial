/**
 * The Solve screen's run as a reducer (components/solve/useSolveRun.ts drives it with the solver worker): phase,
 * progress, result, node locks and the saved state of the result. Pure, so the tests can walk through the phases:
 *
 *   idle ──start──▶ building ──built──▶ running ──finished──▶ done          (a cancelled run is `finished`, stopped)
 *                       └────────────────┴──failed──▶ idle (with the error)
 *   done ──lockStart──▶ locking ──relocked──▶ … ──lockEnd──▶ done           (an error is kept, the old result stays)
 */
import { cardText } from "../postflop/combos";
import type { PfFlop } from "../postflop/decode";
import type { SavedSolve } from "../storage/types";
import type { Progress } from "./client";
import { fullConfig } from "./form";
import type { SolveForm } from "./form";

export type Phase = "idle" | "building" | "running" | "done" | "locking";

export interface SolveResult {
  flop: PfFlop;
  /** exported node id -> solver tree node id */
  map: Uint32Array;
  exploit: number;
  iterations: number;
  /** the TSP1 file, as saved */
  bytes: Uint8Array;
  /** the run was cancelled before its iterations were done */
  stopped: boolean;
}

export interface SolveRun {
  phase: Phase;
  progress: Progress | null;
  /** the last measured exploitability (progress events between two measurements carry -1) */
  lastExploit: number | null;
  /** nodes of the solver's game tree */
  nodes: number;
  error: string | null;
  result: SolveResult | null;
  /** the node of the result on screen (exported node id) */
  viewNode: number;
  /** solver tree node id -> the seat locked there */
  locks: Map<number, string>;
  /** the id the result is saved under, null while it is not saved */
  savedId: string | null;
  /** a short message next to the save button */
  note: string;
}

export const INITIAL_RUN: SolveRun = { phase: "idle", progress: null, lastExploit: null, nodes: 0, error: null, result: null, viewNode: 0, locks: new Map(), savedId: null, note: "" };

export type RunAction =
  | { type: "start" }
  | { type: "built"; nodes: number }
  | { type: "progress"; progress: Progress }
  | { type: "finished"; result: SolveResult }
  | { type: "failed"; error: string }
  | { type: "lockStart" }
  /** a lock was set (seat) or removed (null) at a solver tree node */
  | { type: "lock"; tree: number; seat: string | null }
  /** the result of the run after a lock change; the screen stays on the locked node when it is still exported */
  | { type: "relocked"; result: SolveResult; keepNode: number }
  | { type: "lockEnd"; error?: string }
  | { type: "view"; node: number }
  | { type: "saved"; id: string; note: string }
  /** a saved solve was opened: back to the inputs, under its id */
  | { type: "reset"; savedId: string };

/** is the solver busy (the inputs are locked)? */
export const isBusy = (p: Phase) => p === "building" || p === "running" || p === "locking";

export function runReducer(s: SolveRun, a: RunAction): SolveRun {
  switch (a.type) {
    case "start":
      return { ...s, error: null, note: "", savedId: null, result: null, locks: new Map(), progress: null, lastExploit: null, phase: "building" };
    case "built":
      return { ...s, nodes: a.nodes, phase: "running" };
    case "progress":
      return { ...s, progress: a.progress, lastExploit: a.progress.exploit >= 0 ? a.progress.exploit : s.lastExploit };
    case "finished":
      return { ...s, result: a.result, viewNode: 0, lastExploit: a.result.exploit, phase: "done" };
    case "failed":
      return { ...s, error: a.error, phase: "idle" };
    case "lockStart":
      return { ...s, error: null, phase: "locking", progress: null };
    case "lock": {
      const locks = new Map(s.locks);
      if (a.seat === null) locks.delete(a.tree);
      else locks.set(a.tree, a.seat);
      return { ...s, locks };
    }
    case "relocked": {
      const n = a.result.flop.nodes.length;
      return { ...s, result: a.result, viewNode: a.keepNode >= 0 && a.keepNode < n ? a.keepNode : 0, lastExploit: a.result.exploit, savedId: null };
    }
    case "lockEnd":
      return { ...s, ...(a.error !== undefined && { error: a.error }), phase: "done" };
    case "view":
      return { ...s, viewNode: a.node };
    case "saved":
      return { ...s, savedId: a.id, note: a.note };
    case "reset":
      return { ...s, savedId: a.savedId, result: null, phase: "idle" };
  }
}

/** the record a result is saved as (IndexedDB `solves`); without a name it is called after the board and the seats */
export function savedSolveOf(form: SolveForm, result: SolveResult, id: string, ts: number): SavedSolve {
  const auto = `${form.board.map((c) => cardText(c)).join(" ")} · ${form.oopName} vs ${form.ipName}`;
  return {
    id,
    ts,
    title: form.title.trim() || auto,
    board: form.board,
    cfg: fullConfig(form),
    oopName: form.oopName,
    ipName: form.ipName,
    oopText: form.oopText,
    ipText: form.ipText,
    exploit: result.exploit,
    iterations: result.iterations,
    bytes: result.bytes,
    nodes: result.flop.nodes.length,
  };
}
