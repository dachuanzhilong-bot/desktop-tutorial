/**
 * Core poker logic the app relies on: equity numbers, chip accounting of bets / all-ins,
 * and that spaced repetition really asks missed hands more often.
 * (Hand evaluation itself is tested in the Rust solver: solver/src/eval.rs.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classByName, NUM_CLASSES } from "../poker/hands";
import { DEFAULT_FILTER, candidateNodes, pickHand } from "../practice/sampler";
import { mixedness, updateSrs } from "../practice/srs";
import type { SrsItem } from "../practice/srs";
import { applyAction, initialState, stateAt } from "../solution/tree";
import { ActionKind } from "../solution/types";
import type { Manifest } from "../solution/types";
import { mulberry32 } from "../util/rng";
import { loadManifest, loadManifestFor, loadNode } from "./helpers";

const K = NUM_CLASSES;

describe("pre-flop all-in equity (public/data/equity169.bin, used by the ICM solver)", () => {
  const buf = readFileSync(path.resolve(__dirname, "../../../public/data/equity169.bin"));
  const t = new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const eq = (a: string, b: string) => t[classByName(a) * K + classByName(b)] / 65535;

  // reference values: the well-known all-in equities (ties count half). The table itself is a Monte Carlo estimate
  // (solver/src/bin/export_equity.rs, 60,000 boards per pair of hand classes), hence the 1.2% tolerance.
  it.each([
    ["AA", "KK", 0.82],
    ["KK", "AA", 0.18],
    ["AKs", "QQ", 0.46],
    ["22", "AKo", 0.525],
    ["AA", "72o", 0.88],
    ["AKo", "AQo", 0.74],
    ["JTs", "AKo", 0.415],
  ] as const)("%s vs %s ≈ %f", (a, b, want) => {
    expect(Math.abs(eq(a, b) - want)).toBeLessThan(0.012);
  });
});

/** follow actions by kind from the root, e.g. [AllIn, Fold, Fold, Fold, Fold, Call] */
function follow(m: Manifest, kinds: ActionKind[]): number {
  let id = 0;
  for (const k of kinds) {
    const a = m.nodes[id].actions.find((x) => x.kind === k);
    if (!a || a.child < 0) throw new Error(`no ${ActionKind[k]} at node ${id}`);
    id = a.child;
  }
  return id;
}

describe("chips: bets, calls, folds and all-ins", () => {
  const { Fold, Call, Raise, AllIn } = ActionKind;

  it("blinds, open, 3-bet and calls at 100bb", () => {
    const m = loadManifest();
    const s0 = initialState(m);
    expect(s0.inv).toEqual([0, 0, 0, 0, 0.5, 1]);
    expect(s0.pot).toBe(1.5);
    // UTG opens 2.5, everyone folds to the BB who calls: 2.5 + 2.5 + 0.5 dead
    const flop = stateAt(m, follow(m, [Raise, Fold, Fold, Fold, Fold]));
    expect(flop.pot).toBeCloseTo(4, 6);
    const afterCall = applyAction(flop, 5, m.nodes[follow(m, [Raise, Fold, Fold, Fold, Fold])].actions.find((a) => a.kind === Call)!);
    expect(afterCall.inv[5]).toBe(2.5);
    expect(afterCall.pot).toBeCloseTo(5.5, 6);
    // BTN opens, the BB 3-bets out of position to 11 (3x + 3.5)
    const bb = follow(m, [Fold, Fold, Fold, Raise, Fold]);
    const threeBet = m.nodes[bb].actions.find((a) => a.kind === Raise)!;
    expect(threeBet.to).toBeCloseTo(11, 6);
    const s = applyAction(stateAt(m, bb), 5, threeBet);
    expect(s.cur).toBeCloseTo(11, 6);
    expect(s.level).toBe(2);
    expect(s.pot).toBeCloseTo(2.5 + 0.5 + 11, 6);
  });

  it("a limp completes to the big blind, folding keeps what is already in", () => {
    const m = loadManifest();
    const sb = follow(m, [Fold, Fold, Fold, Fold]);
    const limp = applyAction(stateAt(m, sb), 4, m.nodes[sb].actions.find((a) => a.kind === Call)!);
    expect(limp.inv[4]).toBe(1);
    expect(limp.limped).toBe(true);
    expect(limp.level).toBe(0);
    const fold = applyAction(stateAt(m, sb), 4, m.nodes[sb].actions.find((a) => a.kind === Fold)!);
    expect(fold.inv[4]).toBe(0.5);
    expect(fold.folded[4]).toBe(true);
  });

  it("an all-in is capped at the stack and a call matches it exactly (20bb)", () => {
    const m = loadManifestFor(20);
    const jam = m.nodes[0].actions.find((a) => a.kind === AllIn)!;
    expect(jam.to).toBe(20);
    const id = follow(m, [AllIn, Fold, Fold, Fold, Fold]);
    expect(m.nodes[id].actor).toBe(5);
    const call = m.nodes[id].actions.find((a) => a.kind === Call)!;
    const end = applyAction(stateAt(m, id), 5, call);
    expect(end.inv).toEqual([20, 0, 0, 0, 0.5, 20]);
    expect(end.pot).toBeCloseTo(40.5, 6);
    // no bet anywhere in any line goes beyond the stack
    for (const n of m.nodes) for (const a of n.actions) expect(a.to).toBeLessThanOrEqual(20);
  });

  it("a short re-shove over an open is an all-in, not a raise beyond the stack (40bb)", () => {
    const m = loadManifestFor(40);
    // UTG and HJ fold, CO opens: the BTN may re-shove 40bb
    const btn = m.nodes[follow(m, [Fold, Fold, Raise])];
    expect(btn.actor).toBe(3);
    const shove = btn.actions.find((a) => a.kind === AllIn);
    expect(shove?.to).toBe(40);
    for (const a of btn.actions) if (a.kind === Raise) expect(a.to).toBeLessThan(40);
  });
});

describe("spaced repetition asks missed hands more often (real 100bb UTG spot)", () => {
  const m = loadManifest();
  const sol = loadNode(m, 0);
  // two pure folds with the same number of combos: only their practice history differs
  const missed = classByName("Q4o");
  const control = classByName("J4o");
  const fr = (h: number) => Array.from({ length: sol.na }, (_, a) => sol.freq[a * K + h]);

  // the items of the root decision, by hand class (the practice screen looks them up by position: SrsIndex.find)
  const ROOT = { solution: "cash6max-100bb", pos: "root" };
  const count = (srs: Map<number, SrsItem>, now: number, n = 30_000) => {
    const rnd = mulberry32(7);
    const c = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const h = pickHand(sol, DEFAULT_FILTER, rnd, (hand) => srs.get(hand), now);
      c.set(h, (c.get(h) ?? 0) + 1);
    }
    return c;
  };

  it("preconditions: both hands are pure, equally frequent combos, and the root is a practice candidate", () => {
    expect(mixedness(fr(missed))).toBe(0);
    expect(mixedness(fr(control))).toBe(0);
    expect(candidateNodes(m, DEFAULT_FILTER)).toContain(0);
  });

  it("a miss makes the hand come back several times as often; a mastered hand comes back less", () => {
    const now = Date.UTC(2026, 0, 1);
    const plain = count(new Map(), now);
    const base = (plain.get(missed) ?? 0) / (plain.get(control) ?? 1);
    expect(base).toBeGreaterThan(0.85);
    expect(base).toBeLessThan(1.15);

    // answered wrong once: due again immediately
    const wrong = updateSrs(undefined, ROOT, 0, missed, "blunder", now - 60_000);
    const afterMiss = count(new Map([[wrong.hand, wrong]]), now);
    expect((afterMiss.get(missed) ?? 0) / (afterMiss.get(control) ?? 1)).toBeGreaterThan(4);

    // answered right twice: scheduled days ahead, asked less until then
    let ok = updateSrs(undefined, ROOT, 0, missed, "best", now - 120_000);
    ok = updateSrs(ok, ROOT, 0, missed, "best", now - 60_000);
    expect(ok.due).toBeGreaterThan(now + 60 * 60_000);
    const mastered = count(new Map([[ok.hand, ok]]), now);
    expect((mastered.get(missed) ?? 0) / (mastered.get(control) ?? 1)).toBeLessThan(0.5);

    // once it is due again, it is back to (more than) normal
    const later = count(new Map([[ok.hand, ok]]), ok.due + 1);
    expect((later.get(missed) ?? 0) / (later.get(control) ?? 1)).toBeGreaterThan(1.5);
  });

  it("forced moves (folding behind an all-in and a call) are never asked", () => {
    for (const d of [20, 100]) {
      const md = loadManifestFor(d);
      for (const id of candidateNodes(md, DEFAULT_FILTER)) expect(md.nodes[id].actions.length).toBeGreaterThanOrEqual(2);
    }
  });
});
