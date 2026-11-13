import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBoard } from "../postflop/combos";
import { DEFAULT_SOLVE } from "../solve/config";
import { loadDraft, saveDraft, SOLVE_DRAFT_SCHEMA } from "../solve/draft";
import type { SolveDraft } from "../solve/draft";
import { draftOf, formReducer, fullConfig, INITIAL_FORM, iterFor, TARGET } from "../solve/form";
import type { FormAction, SolveForm } from "../solve/form";
import { INITIAL_RUN, isBusy, runReducer, savedSolveOf } from "../solve/run";
import type { RunAction, SolveResult, SolveRun } from "../solve/run";
import type { PfFlop } from "../postflop/decode";
import type { SavedSolve } from "../storage/types";

// The Solve screen's state (app/solve/page.tsx through useSolveForm / useSolveRun) as pure reducers.

const form = (...actions: FormAction[]) => actions.reduce(formReducer, INITIAL_FORM);
const runOf = (...actions: RunAction[]) => actions.reduce(runReducer, INITIAL_RUN);
const phases = (...actions: RunAction[]) => {
  const out: string[] = [];
  actions.reduce((s, a) => {
    const n = runReducer(s, a);
    out.push(n.phase);
    return n;
  }, INITIAL_RUN);
  return out;
};

/** a result whose flop has `n` nodes */
const result = (n: number, exploit = 0.8, stopped = false): SolveResult => ({
  flop: { nodes: Array.from({ length: n }, (_, id) => ({ id })) } as unknown as PfFlop,
  map: Uint32Array.from({ length: n }, (_, i) => 100 + i),
  exploit,
  iterations: 300,
  bytes: new Uint8Array([1, 2, 3]),
  stopped,
});

describe("the inputs (useSolveForm)", () => {
  it("starts with BB vs BTN on Ks 7d 2c, standard accuracy", () => {
    expect(INITIAL_FORM).toMatchObject({ board: parseBoard("Ks 7d 2c"), oopName: "BB", ipName: "BTN", pot: "5.5", stack: "97.5", cfg: DEFAULT_SOLVE, acc: "std", iterations: 250, target: 1, title: "" });
  });

  it("an accuracy preset sets the iterations of the first street solved and its target", () => {
    expect(form({ type: "accuracy", acc: "draft" })).toMatchObject({ acc: "draft", iterations: 60, target: TARGET.draft });
    const river = form({ type: "set", patch: { board: parseBoard("Ks 7d 2c 9h 3s") } }, { type: "accuracy", acc: "high" });
    expect(river).toMatchObject({ iterations: 4000, target: 0.5 });
  });

  it("another first street resets the iteration count, a hand-set count stays while the street does", () => {
    const s = form({ type: "set", patch: { iterations: 777 } });
    expect(s.iterations).toBe(777);
    expect(formReducer(s, { type: "set", patch: { board: parseBoard("Ks 7d 9c") } }).iterations).toBe(777);
    const turn = formReducer(s, { type: "set", patch: { board: parseBoard("Ks 7d 2c 9h") } });
    expect(turn.iterations).toBe(iterFor("std", 4));
    // a board being picked card by card: below three cards is the flop count again
    expect(formReducer(turn, { type: "set", patch: { board: [] } }).iterations).toBe(iterFor("std", 3));
  });

  it("preset ranges only go into an empty field", () => {
    const s = form({ type: "set", patch: { oopText: "AA" } }, { type: "fillRanges", oop: "KK+", ip: "22+" });
    expect(s).toMatchObject({ oopText: "AA", ipText: "22+" });
    expect(formReducer(s, { type: "fillRanges" })).toMatchObject({ oopText: "AA", ipText: "22+" });
  });

  it("a saved solve comes back with its board, sizes, pot, stack, ranges, seats and name", () => {
    const solve = { id: "s1", ts: 1, title: "mine", board: parseBoard("Ks 7d 2c 9h"), cfg: { ...DEFAULT_SOLVE, pot: 20.5, stack: 89 }, oopName: "SB", ipName: "CO", oopText: "QQ+", ipText: "AKs", exploit: 1, iterations: 10, bytes: new Uint8Array(), nodes: 1 } as SavedSolve;
    const s = form({ type: "accuracy", acc: "high" }, { type: "load", solve });
    expect(s).toMatchObject({ board: solve.board, pot: "20.5", stack: "89", cfg: solve.cfg, oopText: "QQ+", ipText: "AKs", oopName: "SB", ipName: "CO", title: "mine", iterations: iterFor("high", 4) });
    expect(fullConfig(s)).toEqual(solve.cfg);
  });
});

describe("the draft in localStorage", () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  const edited = () =>
    form(
      { type: "set", patch: { board: parseBoard("Ah Kd 5c"), oopText: "QQ+", ipText: "22+", oopName: "SB", ipName: "BTN", pot: "12", stack: "88.5", cfg: { ...DEFAULT_SOLVE, bets: [[0.33, 0.75], [0.66], [1]], turnCards: 6 } } },
      { type: "accuracy", acc: "high" },
      { type: "set", patch: { iterations: 900, target: 0.3, title: "not in the draft" } },
    );

  it("stores the same fields and values as before the split (key tessera.solveDraft.v1)", () => {
    saveDraft(draftOf(edited()));
    const raw = JSON.parse(localStorage.getItem(SOLVE_DRAFT_SCHEMA.key)!);
    const expected: SolveDraft = { board: parseBoard("Ah Kd 5c"), oopText: "QQ+", ipText: "22+", oopName: "SB", ipName: "BTN", pot: 12, stack: 88.5, cfg: { ...DEFAULT_SOLVE, bets: [[0.33, 0.75], [0.66], [1]], turnCards: 6 }, acc: "high", iterations: 900, target: 0.3 };
    expect(raw).toEqual({ ...expected, _v: 2 });
  });

  it("restores into the same inputs it was saved from", () => {
    const s = edited();
    saveDraft(draftOf(s));
    const back = formReducer(INITIAL_FORM, { type: "restore", draft: loadDraft() });
    expect({ ...back, title: s.title }).toEqual(s);
  });

  it("a field the draft lacks keeps the screen's default; an empty pot is stored as 0 and not restored", () => {
    saveDraft(draftOf(form({ type: "set", patch: { pot: "", oopText: "AA" } })));
    const back = formReducer(INITIAL_FORM, { type: "restore", draft: loadDraft() });
    expect(back).toMatchObject({ pot: "5.5", oopText: "AA", ipText: "" });
  });

  it("a draft for another street gets that street's iteration count, as the screen always did", () => {
    saveDraft({ board: parseBoard("Ks 7d 2c 9h 3s"), acc: "draft", iterations: 1234 });
    expect(formReducer(INITIAL_FORM, { type: "restore", draft: loadDraft() })).toMatchObject({ acc: "draft", iterations: iterFor("draft", 5) });
  });
});

describe("the run (useSolveRun)", () => {
  it("input → building → running → done", () => {
    expect(phases({ type: "start" }, { type: "built", nodes: 27 }, { type: "finished", result: result(5) })).toEqual(["building", "running", "done"]);
    const s = runOf({ type: "start" }, { type: "built", nodes: 27 }, { type: "progress", progress: { done: 10, total: 300, exploit: -1 } });
    expect(s).toMatchObject({ phase: "running", nodes: 27, progress: { done: 10 }, lastExploit: null });
    expect(isBusy(s.phase)).toBe(true);
    const p = runReducer(s, { type: "progress", progress: { done: 60, total: 300, exploit: 2.5 } });
    expect(runReducer(p, { type: "progress", progress: { done: 70, total: 300, exploit: -1 } }).lastExploit).toBe(2.5);
    const done = runReducer(p, { type: "finished", result: result(5, 0.7) });
    expect(done).toMatchObject({ phase: "done", viewNode: 0, lastExploit: 0.7 });
    expect(isBusy(done.phase)).toBe(false);
  });

  it("a cancelled run is done, with a stopped result", () => {
    const s = runOf({ type: "start" }, { type: "built", nodes: 27 }, { type: "finished", result: result(5, 3, true) });
    expect(s.phase).toBe("done");
    expect(s.result!.stopped).toBe(true);
  });

  it("an error while building or running goes back to the inputs with the message", () => {
    expect(phases({ type: "start" }, { type: "failed", error: "x" })).toEqual(["building", "idle"]);
    expect(runOf({ type: "start" }, { type: "built", nodes: 3 }, { type: "failed", error: "boom" })).toMatchObject({ phase: "idle", error: "boom", result: null });
  });

  it("a new run clears the previous result, its locks, error, note and saved id", () => {
    const before: SolveRun = { ...runOf({ type: "start" }, { type: "built", nodes: 3 }, { type: "finished", result: result(5) }, { type: "lock", tree: 101, seat: "BB" }, { type: "saved", id: "s1", note: "ok" }), error: "old" };
    expect(before.locks.size).toBe(1);
    expect(runReducer(before, { type: "start" })).toMatchObject({ phase: "building", result: null, error: null, note: "", savedId: null, progress: null, lastExploit: null, locks: new Map() });
  });

  it("node lock: done → locking → done, on the locked node when it is still exported; the result is no longer saved", () => {
    const done = runOf({ type: "start" }, { type: "built", nodes: 3 }, { type: "finished", result: result(5) }, { type: "saved", id: "s1", note: "ok" }, { type: "view", node: 3 });
    expect(phases({ type: "lockStart" })).toEqual(["locking"]);
    let s = runReducer(done, { type: "lockStart" });
    expect(s).toMatchObject({ phase: "locking", progress: null, error: null });
    s = runReducer(s, { type: "lock", tree: 103, seat: "BB" });
    s = runReducer(s, { type: "relocked", result: result(6, 0.5), keepNode: 3 });
    expect(s).toMatchObject({ phase: "locking", viewNode: 3, lastExploit: 0.5, savedId: null });
    s = runReducer(s, { type: "lockEnd" });
    expect(s).toMatchObject({ phase: "done", error: null });
    expect([...s.locks]).toEqual([[103, "BB"]]);
    // unlocking; the node is gone from the new export: back to the root
    s = runReducer(runReducer(runReducer(s, { type: "lockStart" }), { type: "lock", tree: 103, seat: null }), { type: "relocked", result: result(2), keepNode: -1 });
    expect(s.viewNode).toBe(0);
    expect(s.locks.size).toBe(0);
  });

  it("a failed lock keeps the result and reports the error", () => {
    const done = runOf({ type: "start" }, { type: "built", nodes: 3 }, { type: "finished", result: result(5) });
    const s = runReducer(runReducer(done, { type: "lockStart" }), { type: "lockEnd", error: "lock rejected" });
    expect(s).toMatchObject({ phase: "done", error: "lock rejected" });
    expect(s.result).toBe(done.result);
  });

  it("opening a saved solve goes back to the inputs under its id", () => {
    const done = runOf({ type: "start" }, { type: "built", nodes: 3 }, { type: "finished", result: result(5) });
    expect(runReducer(done, { type: "reset", savedId: "s9" })).toMatchObject({ phase: "idle", result: null, savedId: "s9" });
  });

  it("a result is saved with the inputs it was solved from, named after the board without a name", () => {
    const f: SolveForm = form({ type: "set", patch: { board: parseBoard("Ks 7d 2c 9h 3s"), pot: "10", stack: "30", oopText: "QQ", ipText: "AA" } });
    const r = result(4, 0.9);
    const s = savedSolveOf(f, r, "s1", 42);
    expect(s).toEqual({ id: "s1", ts: 42, title: "Ks 7d 2c 9h 3s · BB vs BTN", board: f.board, cfg: { ...DEFAULT_SOLVE, pot: 10, stack: 30 }, oopName: "BB", ipName: "BTN", oopText: "QQ", ipText: "AA", exploit: 0.9, iterations: 300, bytes: r.bytes, nodes: 4 });
    expect(savedSolveOf({ ...f, title: "  river  " }, r, "s1", 42).title).toBe("river");
  });
});
