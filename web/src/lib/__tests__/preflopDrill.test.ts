/**
 * The pre-flop game of the shared session (lib/practice/preflopDrill.ts, REFACTOR_PLAN 2-2). The references are the
 * pre-flop screen's code before the move (components/practice/Session.tsx up to step 2-1), restated here:
 *   keys      F / C / R / A: the first action of that kind; 1..9: the action of that number, when there is one
 *   time out  the fold, or the first action when folding is not on offer
 *   answer    judge(q, i); the table after the hero's action; the next node (hand mode goes on from it) or how the line
 *             ends, as a text only in hand mode; `term` -2 for a pruned line
 *   saving    recordAnswer with the score after the hint penalty, the time, the timeout and hint flags
 */
import { describe, expect, it } from "vitest";
import { classByName } from "../poker/hands";
import type { Answered } from "../practice/drill";
import { judge, stepsTo } from "../practice/engine";
import { createPreflopDrill } from "../practice/preflopDrill";
import type { PreflopDrillConfig, PreflopOutcome, PreflopRound } from "../practice/preflopDrill";
import { DEFAULT_FILTER } from "../practice/sampler";
import { applyAction, initialState, stateAt } from "../solution/tree";
import { ActionKind, Terminal } from "../solution/types";
import { MemoryRepo } from "../storage/memory";
import { mulberry32 } from "../util/rng";
import { loadManifest, loadNode, walk } from "./helpers";

const m = loadManifest();
const store = { manifest: m, build: "b-test", node: async (id: number) => loadNode(m, id) };
const NODE = walk(m, "FFR"); // UTG, HJ fold, CO opens: the button faces an open
const AKS = classByName("AKs");
const drill = (config: Partial<PreflopDrillConfig> = {}, repo = new MemoryRepo(), seed = 1) =>
  createPreflopDrill({ store, repo, config: { mode: "spot", filter: DEFAULT_FILTER, rng: false, ...config }, rnd: mulberry32(seed), now: () => 1_800_000_000_000 });
/** a round at `nodeId` with `hand` (dealt as a spot drill would), and a drill of `mode` to answer it */
const fixedRound = async (nodeId = NODE, hand = AKS, mode: "spot" | "hand" = "spot") => {
  const r = (await drill({ fixed: [{ nodeId, hand }] }).start())!;
  return { d: drill({ mode }), r };
};
const settle = (o: PreflopOutcome, extra: Partial<Answered<PreflopOutcome>> = {}): Answered<PreflopOutcome> => ({ ...o, score: o.j.score, ms: 1500, timeout: false, hint: false, ...extra });

/** the keyboard code of Session.tsx before step 2-2 */
function oldKey(actions: { kind: ActionKind }[], k: string): number {
  let idx = -1;
  if (k === "f") idx = actions.findIndex((a) => a.kind === ActionKind.Fold);
  else if (k === "c") idx = actions.findIndex((a) => a.kind === ActionKind.Call);
  else if (k === "r") idx = actions.findIndex((a) => a.kind === ActionKind.Raise);
  else if (k === "a") idx = actions.findIndex((a) => a.kind === ActionKind.AllIn);
  else if (/^[1-9]$/.test(k)) idx = Number(k) - 1 < actions.length ? Number(k) - 1 : -1;
  return idx;
}

describe("pre-flop drill: keys and the time limit", () => {
  it("the shortcuts of every decision are the ones the screen had", () => {
    const d = drill();
    const keys = ["f", "c", "r", "a", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "x", "enter"];
    for (const node of m.nodes) {
      const r = { q: { nodeId: node.id } } as PreflopRound;
      const map = d.shortcuts(r);
      for (const k of keys) expect(Object.hasOwn(map, k) ? map[k] : -1, `node ${node.id} key ${k}`).toBe(oldKey(node.actions, k));
    }
  });

  it("no question, no keys", () => {
    expect(drill().shortcuts({ q: null } as PreflopRound)).toEqual({});
  });

  it("the time limit folds, or takes the first action when there is no fold", () => {
    const d = drill();
    let noFold = 0;
    for (const node of m.nodes) {
      const fold = node.actions.findIndex((a) => a.kind === ActionKind.Fold);
      if (fold < 0) noFold++;
      expect(d.timeout({ q: { nodeId: node.id } } as PreflopRound)).toBe(fold >= 0 ? fold : 0);
    }
    expect(noFold).toBeGreaterThan(0); // the big blind's option is in the tree
  });
});

describe("pre-flop drill: answers", () => {
  it("an answer is judged and leads where the action goes", async () => {
    const { d, r } = await fixedRound();
    const meta = m.nodes[NODE];
    const before = stateAt(m, NODE);
    meta.actions.forEach((a, i) => {
      const o = d.answer(r, i);
      expect(o.j).toEqual(judge(r.q!, i));
      expect(o.before).toEqual(before);
      expect(o.heroAfter).toEqual(applyAction(before, meta.actor, a));
      expect(o.nextNode).toBe(a.child >= 0 ? a.child : null);
      expect(o.term).toBe(a.child === -2 ? -2 : a.child < 0 ? a.term : null);
      expect(o.endKey).toBeNull(); // spot mode: no text for the end of the line
    });
  });

  it("hand mode names how the line ends", async () => {
    const { d, r } = await fixedRound(NODE, AKS, "hand");
    const meta = m.nodes[NODE];
    const fold = meta.actions.findIndex((a) => a.kind === ActionKind.Fold);
    // the button folds to the open: the line goes on (the blinds still act), no text
    expect(d.answer(r, fold).endKey).toBe(meta.actions[fold].child < 0 ? "term.fold" : null);
    const ends = m.nodes.flatMap((n) => n.actions.map((a, i) => ({ n, a, i }))).filter((x) => x.a.child < 0);
    const want = (a: (typeof ends)[number]["a"]) => (a.child === -2 ? "term.pruned" : a.term === Terminal.Fold ? "term.fold" : a.term === Terminal.Flop ? "term.flop" : a.term === Terminal.FlopMulti ? "term.flopMulti" : "term.allin");
    for (const x of ends.slice(0, 400)) {
      const rr = { ...r, q: { ...r.q!, nodeId: x.n.id, stats: x.n.actions.map(() => ({ freq: 0, ev: 0 })) } };
      expect(d.answer(rr, x.i).endKey).toBe(want(x.a));
    }
  });

  it("spot mode deals a new question after an answer; hand mode plays the same hand on", async () => {
    const spot = await fixedRound();
    const call = m.nodes[NODE].actions.findIndex((a) => a.kind === ActionKind.Call);
    expect(await spot.d.next(spot.r, settle(spot.d.answer(spot.r, call)))).toBeNull();

    const hand = await fixedRound(NODE, AKS, "hand");
    const goesOn = m.nodes[NODE].actions.findIndex((x) => x.child >= 0);
    const a = settle(hand.d.answer(hand.r, goesOn));
    expect(a.nextNode).not.toBeNull();
    const r2 = (await hand.d.next(hand.r, a))!;
    expect(r2.startState).toEqual(a.heroAfter);
    expect(r2.cards).toEqual(hand.r.cards);
    expect(r2.hand).toBe(AKS);
    expect(r2.heroSeat).toBe(hand.r.heroSeat);
    if (r2.q) expect(r2.q.cards).toEqual(hand.r.cards);
    else expect(r2.endedWith).not.toBeNull();
    // an action that ends the line: a new hand
    const endNode = m.nodes.find((n) => n.actions.some((x) => x.child < 0))!;
    const end = await fixedRound(endNode.id, AKS, "hand");
    const ending = endNode.actions.findIndex((x) => x.child < 0);
    expect(await end.d.next(end.r, settle(end.d.answer(end.r, ending)))).toBeNull();
  });

  it("the settled answer is saved with the score after the hint, the time and the flags", async () => {
    const repo = new MemoryRepo();
    const d = drill({ fixed: [{ nodeId: NODE, hand: AKS }] }, repo);
    const r = (await d.start())!;
    const o = d.answer(r, 0);
    d.record(r, settle(o, { score: 12, ms: 4321, timeout: true, hint: true }));
    await new Promise((res) => setTimeout(res, 0));
    const [att] = await repo.allAttempts();
    expect(att).toMatchObject({ mode: "spot", nodeId: NODE, hand: AKS, chosen: 0, best: o.j.bestIndex, grade: o.j.grade, score: 12, ms: 4321, timeout: true, hint: true, rng: false, build: "b-test", ts: 1_800_000_000_000 });
    expect(att.sessionId).toMatch(/^s-/);
    expect(await repo.allSrs()).toHaveLength(1);
  });
});

describe("pre-flop drill: dealing", () => {
  it("a fixed list is asked in a shuffled order, each once per pass", async () => {
    const fixed = [walk(m, ""), walk(m, "R"), NODE].map((nodeId, i) => ({ nodeId, hand: [AKS, classByName("72o"), classByName("QQ")][i] }));
    const d = drill({ fixed });
    const key = (r: PreflopRound) => `${r.q!.nodeId}:${r.hand}`;
    const want = fixed.map((x) => `${x.nodeId}:${x.hand}`).sort();
    for (let pass = 0; pass < 2; pass++) {
      const got: string[] = [];
      for (let i = 0; i < fixed.length; i++) {
        const r = (await d.start())!;
        expect(r.heroSeat).toBe(m.nodes[r.q!.nodeId].actor);
        expect(r.startState).toEqual(initialState(m));
        expect(r.queue).toEqual(stepsTo(m, r.q!.nodeId));
        got.push(key(r));
      }
      expect(got.sort()).toEqual(want);
    }
  });

  it("spot mode with no matching decision is empty", async () => {
    expect(await drill({ filter: { ...DEFAULT_FILTER, seats: [5], spots: ["rfi"] } }).start()).toBeNull();
  });

  it("spot and hand mode deal a question for the hero", async () => {
    for (const mode of ["spot", "hand"] as const) {
      const d = drill({ mode }, new MemoryRepo(), 7);
      const r = (await d.start())!;
      expect(d.question(r)).toBe(r.q);
      expect(d.steps(r)).toBe(r.queue);
      expect(m.nodes[r.q!.nodeId].actor).toBe(r.heroSeat);
      expect(r.q!.hand).toBe(r.hand);
    }
  });
});
