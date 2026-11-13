/**
 * Seats from the number of players (REFACTOR_PLAN step 2-5): the table state, spot types, action labels, the
 * post-flop order and the table layout follow manifest.players, with "the last two seats are the blinds (heads-up the
 * small blind is the button)". Small made-up manifests of 2 and 9 players; the shipped 6-max data keeps its meaning.
 */
import { describe, expect, it } from "vitest";
import { POSITIONS } from "../icm/model";
import { allSeats, bbSeat, buttonSeat, postflopRank, sbSeat, seatNames, seatSpot, tableLayout } from "../solution/seats";
import { actionLabel, BB_SEAT, history, initialState, lineText, rfiNode, SB_SEAT, SEATS, spotType, stateAt } from "../solution/tree";
import { ActionKind, Terminal } from "../solution/types";
import type { ActionMeta, Manifest, NodeMeta } from "../solution/types";
import { loadManifest } from "./helpers";

const { Fold, Call, Raise, AllIn } = ActionKind;
type A = [kind: ActionKind, to: number, child: number, term?: Terminal];
const t = (k: string) => k;

/** a manifest from nodes given as [actor, actions]; parents are filled in from the children */
function fakeManifest(players: string[], spec: [actor: number, actions: A[]][]): Manifest {
  const nodes: NodeMeta[] = spec.map(([actor, acts], id) => ({
    id,
    actor,
    reach: 1,
    chunk: 0,
    parent: -1,
    parentAction: -1,
    actions: acts.map(([kind, to, child, term]): ActionMeta => ({ kind, to, child, term: term ?? (child >= 0 ? Terminal.None : Terminal.Fold) })),
  }));
  for (const n of nodes)
    n.actions.forEach((a, i) => {
      if (a.child >= 0) {
        nodes[a.child].parent = n.id;
        nodes[a.child].parentAction = i;
      }
    });
  return { format: 1, id: `fake-${players.length}`, players, stack: 100, blinds: [0.5, 1], info: {}, chunks: [], nodes };
}

describe("seat names: the last two seats are the blinds, named from the back (BB, SB, BTN, CO, HJ, LJ), UTG first from six seats", () => {
  it("6 seats are the shipped table's: UTG HJ CO BTN SB BB, blinds 4 and 5, button 3", () => {
    const shipped = loadManifest();
    expect(seatNames(6)).toEqual(shipped.players);
    expect(seatNames(6)).toEqual(["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
    expect([sbSeat(6), bbSeat(6), buttonSeat(6)]).toEqual([4, 5, 3]);
    // the 6-max defaults kept for places without a manifest are the same
    expect([...SEATS]).toEqual(shipped.players);
    expect([SB_SEAT, BB_SEAT]).toEqual([4, 5]);
  });

  it("2 seats: SB (also the button) and BB", () => {
    expect(seatNames(2)).toEqual(["SB", "BB"]);
    expect([sbSeat(2), bbSeat(2), buttonSeat(2)]).toEqual([0, 1, 0]);
  });

  it("9 seats: UTG UTG+1 UTG+2 LJ HJ CO BTN SB BB, blinds 7 and 8, button 6", () => {
    expect(seatNames(9)).toEqual(["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB", "BB"]);
    expect([sbSeat(9), bbSeat(9), buttonSeat(9)]).toEqual([7, 8, 6]);
  });

  it("every table size of 2 to 9 is named as the ICM screen names it", () => {
    for (let n = 2; n <= 9; n++) expect(seatNames(n), `${n} seats`).toEqual(POSITIONS[n]);
  });

  it("a table needs two seats", () => {
    expect(() => seatNames(1)).toThrow();
    expect(() => seatNames(2.5)).toThrow();
  });
});

describe("post-flop order: SB, BB, then seat 0 ... the button; heads-up the big blind first", () => {
  it("6 seats keep the order the hand analysis used (SB, BB, UTG, HJ, CO, BTN)", () => {
    expect(allSeats(6).map((s) => postflopRank(s, 6))).toEqual([2, 3, 4, 5, 0, 1]);
  });
  it("2 seats: BB acts first, SB (the button) last", () => {
    expect(allSeats(2).map((s) => postflopRank(s, 2))).toEqual([1, 0]);
  });
  it("9 seats: SB first, BTN last, and every seat has its own rank", () => {
    const r = allSeats(9).map((s) => postflopRank(s, 9));
    expect(r).toEqual([2, 3, 4, 5, 6, 7, 8, 0, 1]);
    expect(r[buttonSeat(9)]).toBe(8);
  });
});

describe("heads-up (2 players): SB = BTN acts first preflop, BB last", () => {
  // 0 SB: fold | limp -> 1 | open 2.5 -> 2
  // 1 BB after the limp: check (flop) | raise 4 -> 3
  // 2 BB vs the open: fold | call (flop) | 3-bet 9 -> 4
  // 3 SB vs the raise after its limp: fold | call
  // 4 SB vs the 3-bet: fold | call | 4-bet 22 -> 5
  // 5 BB vs the 4-bet: fold | all-in
  const m = fakeManifest(seatNames(2), [
    [0, [[Fold, 0, -1], [Call, 1, 1], [Raise, 2.5, 2]]],
    [1, [[Call, 1, -1, Terminal.Flop], [Raise, 4, 3]]],
    [1, [[Fold, 0, -1], [Call, 2.5, -1, Terminal.Flop], [Raise, 9, 4]]],
    [0, [[Fold, 0, -1], [Call, 4, -1, Terminal.Flop]]],
    [0, [[Fold, 0, -1], [Call, 9, -1, Terminal.Flop], [Raise, 22, 5]]],
    [1, [[Fold, 0, -1], [AllIn, 100, -1, Terminal.AllIn]]],
  ]);

  it("stateAt: the blinds are posted by seats 0 and 1, the state has two seats", () => {
    expect(initialState(m)).toEqual({ inv: [0.5, 1], folded: [false, false], pot: 1.5, cur: 1, level: 0, lastRaiser: null, callers: [], limped: false });
    expect(stateAt(m, 0)).toEqual(initialState(m));
    expect(stateAt(m, 1)).toMatchObject({ inv: [1, 1], pot: 2, cur: 1, level: 0, limped: true });
    expect(stateAt(m, 2)).toMatchObject({ inv: [2.5, 1], pot: 3.5, cur: 2.5, level: 1, lastRaiser: 0 });
    expect(stateAt(m, 5)).toMatchObject({ inv: [22, 9], pot: 31, cur: 22, level: 3, lastRaiser: 0 });
  });

  it("spotType: SB first in is RFI, BB after the limp is the limp spot, then vs open / 3-bet / 4-bet", () => {
    expect(m.nodes.map((n) => spotType(m, n.id))).toEqual(["rfi", "limp", "vsOpen", "vsOpen", "vs3bet", "vs4bet"]);
  });

  it("the big blind checks, the small blind limps; the line names the seats", () => {
    const call = m.nodes[1].actions[0];
    expect(actionLabel(call, 1, stateAt(m, 1), t)).toBe("act.check");
    expect(actionLabel(m.nodes[0].actions[1], 0, stateAt(m, 0), t)).toBe("act.limp");
    expect(lineText(m, 5, t)).toBe("SB act.raise 2.5 · BB act.raise 9 · SB act.raise 22");
    expect(rfiNode(m, 0)).toBe(0);
  });
});

describe("9 players: seats 7 (SB) and 8 (BB) post the blinds", () => {
  // 0 UTG: fold -> 1 | open 2.5 -> 9
  // 1..6 fold to the next seat (6 = BTN: fold -> 7 | open 2.5 -> 12)
  // 7 SB: fold | limp -> 8
  // 8 BB after the limp: check (flop) | raise 4 (ends, for the test)
  // 9 UTG+1 vs the UTG open: fold | call -> 10
  // 10 UTG+2 after open and call: fold | squeeze 11 -> 11
  // 11 LJ vs the squeeze with a caller before it: fold
  // 12 SB vs the BTN open: fold
  const folds = (next: number): A => [Fold, 0, next];
  const m = fakeManifest(seatNames(9), [
    [0, [folds(1), [Raise, 2.5, 9]]],
    [1, [folds(2)]],
    [2, [folds(3)]],
    [3, [folds(4)]],
    [4, [folds(5)]],
    [5, [folds(6)]],
    [6, [folds(7), [Raise, 2.5, 12]]],
    [7, [[Fold, 0, -1], [Call, 1, 8]]],
    [8, [[Call, 1, -1, Terminal.Flop], [Raise, 4, -1, Terminal.Fold]]],
    [1, [[Fold, 0, -1], [Call, 2.5, 10]]],
    [2, [[Fold, 0, -1], [Raise, 11, 11]]],
    [3, [[Fold, 0, -1]]],
    [7, [[Fold, 0, -1]]],
  ]);

  it("stateAt: nine seats, the blinds at 7 and 8", () => {
    const s0 = initialState(m);
    expect(s0.inv).toEqual([0, 0, 0, 0, 0, 0, 0, 0.5, 1]);
    expect(s0.folded).toEqual(new Array(9).fill(false));
    expect(stateAt(m, 8)).toMatchObject({ inv: [0, 0, 0, 0, 0, 0, 0, 1, 1], pot: 2, level: 0, limped: true });
    expect(stateAt(m, 8).folded).toEqual([true, true, true, true, true, true, true, false, false]);
    expect(stateAt(m, 11)).toMatchObject({ inv: [2.5, 2.5, 11, 0, 0, 0, 0, 0.5, 1], pot: 17.5, cur: 11, level: 2, lastRaiser: 2 });
    expect(history(m, 12).map((h) => h.actor)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("spotType: RFI from every seat, the BB after a SB limp, vs open, squeeze and vs squeeze", () => {
    expect(allSeats(8).map((s) => spotType(m, rfiNode(m, s)!))).toEqual(new Array(8).fill("rfi"));
    expect(spotType(m, 8)).toBe("limp");
    expect(spotType(m, 9)).toBe("vsOpen");
    expect(spotType(m, 10)).toBe("squeeze");
    expect(spotType(m, 11)).toBe("vsSqueeze");
    expect(spotType(m, 12)).toBe("vsOpen");
  });

  it("the big blind (seat 8) checks after a limp, not seat 5", () => {
    expect(actionLabel(m.nodes[8].actions[0], 8, stateAt(m, 8), t)).toBe("act.check");
    expect(actionLabel(m.nodes[7].actions[1], 7, stateAt(m, 7), t)).toBe("act.limp");
    expect(lineText(m, 9, t)).toBe("UTG act.raise 2.5");
  });
});

describe("table layout (components/PokerTable.tsx): seats from their number, the hero at the bottom", () => {
  it("6 seats sit exactly where the 6-seat table put them", () => {
    const old = (k: number) => {
      const a = (90 + k * 60) * (Math.PI / 180);
      return { x: 50 + 41 * Math.cos(a), y: 44 + 33 * Math.sin(a) };
    };
    tableLayout(6).forEach((p, k) => {
      expect(p.x).toBe(old(k).x);
      expect(p.y).toBe(old(k).y);
      if (k === 0) expect([p.betX, p.betY]).toEqual([72, 62]);
      else expect([p.betX, p.betY]).toEqual([50 + (p.x - 50) * 0.55, 42 + (p.y - 42) * 0.55]);
    });
  });

  it.each([2, 9])("%i seats: one spot per seat, the hero at the bottom centre, the others clockwise and evenly spaced", (n) => {
    const layout = tableLayout(n);
    expect(layout).toHaveLength(n);
    expect(layout[0].x).toBeCloseTo(50);
    expect(layout[0].y).toBeCloseTo(77);
    const angles = layout.map((p) => Math.atan2((p.y - 44) / 33, (p.x - 50) / 41));
    for (let k = 1; k < n; k++) {
      const step = (((angles[k] - angles[k - 1]) * 180) / Math.PI + 360) % 360;
      expect(step).toBeCloseTo(360 / n);
    }
    // no two seats on the same spot
    expect(new Set(layout.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)).size).toBe(n);
  });

  it("heads-up the opponent sits opposite the hero, whichever seat the hero has", () => {
    const layout = tableLayout(2);
    for (const hero of [0, 1]) {
      expect(seatSpot(layout, hero, hero).y).toBeCloseTo(77);
      expect(seatSpot(layout, 1 - hero, hero).x).toBeCloseTo(50);
      expect(seatSpot(layout, 1 - hero, hero).y).toBeCloseTo(11);
    }
  });

  it("9 seats: the hero's spot is the bottom one, the seat after the hero is next clockwise", () => {
    const layout = tableLayout(9);
    for (const hero of allSeats(9)) {
      expect(seatSpot(layout, hero, hero)).toBe(layout[0]);
      expect(seatSpot(layout, (hero + 1) % 9, hero)).toBe(layout[1]);
      expect(seatSpot(layout, (hero + 8) % 9, hero)).toBe(layout[8]);
    }
  });
});
