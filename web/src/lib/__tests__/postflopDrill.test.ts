/**
 * The post-flop drill (REFACTOR_PLAN 2-3). The references are the post-flop screen's code before the step
 * (components/postflop/PostSession.tsx and lib/postflop/practice.ts up to step 2-2), restated here where it is needed:
 *   question  buildPostQuestion put this combo's numbers into a one-hand NodeSolution (`barSol`, Float32Arrays) for
 *             the frequency bars and the explanation; the question now carries them itself
 *   keys      F / C / R / A: the first edge of that kind (fold / check-call / bet-raise / all-in); 1..9: that edge
 *   time out  the fold, else the check (or call), else the first action
 *   answer    judge(q, i); the next node is the edge's code when it is a node; a play-through names how the action
 *             ends the hand (fold / showdown / all-in / pruned), a spot drill never does
 *   dealing   `start` (spot: a node of the asked streets, the line replayed from the flop; play-through: a combo from
 *             the hero's first range, the opponent and the cards played until the hero acts) and `next` (play-through:
 *             the same hand goes on from the node the answer leads to, the board so far not redealt)
 *   table     the `view` memo: the node shown, each player's last move, the chips on the street, who folded, the pot
 *   saving    recordAnswer with the score after the hint penalty, the time, the timeout and hint flags; session "p-…"
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFlop, PfFlop } from "../postflop/decode";
import { createPostflopDrill, postTableView } from "../postflop/drillAdapter";
import type { PostflopOutcome, PostflopRound } from "../postflop/drillAdapter";
import { PF_INDEX } from "../postflop/loader";
import { COMBOS, classOfCards } from "../postflop/combos";
import { advance, buildPostQuestion, pathSteps, pickCombo, pickSpotNode, spotCandidates } from "../postflop/practice";
import type { PStep } from "../postflop/practice";
import { contextAt, labelEdge } from "../postflop/replay";
import type { EdgeLabel } from "../postflop/replay";
import type { PostConfig } from "../postflop/types";
import type { Answered, DrillPhase } from "../practice/drill";
import { buildQuestion, judge } from "../practice/engine";
import type { Question } from "../practice/engine";
import { classByName, NUM_CLASSES } from "../poker/hands";
import { MemoryRepo } from "../storage/memory";
import { mulberry32, weightedPick } from "../util/rng";
import { loadManifest, loadNode, walk } from "./helpers";

const DIR = path.resolve(__dirname, "../../../public/postflop");
const cache = new Map<string, PfFlop>();
const load = (scenario: string, flop: number): PfFlop => {
  const k = `${scenario}/${flop}`;
  if (!cache.has(k)) cache.set(k, { ...decodeFlop(new Uint8Array(gunzipSync(readFileSync(path.join(DIR, scenario, `${flop}.bin.gz`))))), build: `b-${k}` });
  return cache.get(k)!;
};
const FLOPS = [load("srp-btn-bb", 3), load("3bp-btn-bb", 0), load("srp-co-bb", 1)];
const NOW = 1_800_000_000_000;
const CONFIG: PostConfig = { kind: "spot", scenario: "srp-btn-bb", hero: null, streets: [0, 1, 2], rng: false, timer: 0, flop: null };
const drill = (config: Partial<PostConfig> = {}, seed = 1, repo = new MemoryRepo()) =>
  createPostflopDrill({ config: { ...CONFIG, ...config }, repo, rnd: mulberry32(seed), now: () => NOW, index: async () => PF_INDEX, flop: async (s, f) => load(s, f) });
const settle = (o: PostflopOutcome, extra: Partial<Answered<PostflopOutcome>> = {}): Answered<PostflopOutcome> => ({ ...o, score: o.j.score, ms: 1500, timeout: false, hint: false, ...extra });
/** a round asking `nodeId` of `flop` with the first combo of its range */
const roundAt = (flop: PfFlop, nodeId: number, combo = flop.nodes[nodeId].data!.hands[0]): PostflopRound => ({ flop, flopIdx: 0, hero: flop.nodes[nodeId].actor as 0 | 1, combo, steps: pathSteps(flop, nodeId), q: buildPostQuestion(flop, nodeId, combo, mulberry32(9), false), ended: null, lastNode: nodeId });
const decisions = (flop: PfFlop) => flop.nodes.filter((n) => n.type === "decision" && n.data);

/** the keyboard code of PostSession.tsx before step 2-3 */
function oldKey(edges: { kind: number }[], k: string): number {
  let idx = -1;
  if (k === "f") idx = edges.findIndex((x) => x.kind === 0);
  else if (k === "c") idx = edges.findIndex((x) => x.kind === 1);
  else if (k === "r") idx = edges.findIndex((x) => x.kind === 2);
  else if (k === "a") idx = edges.findIndex((x) => x.kind === 3);
  else if (/^[1-9]$/.test(k)) idx = Number(k) - 1 < edges.length ? Number(k) - 1 : -1;
  return idx;
}

/** PostSession.tsx before step 2-3: `start` (with the flop index and the flops at hand, no spaced-repetition items) */
function oldStart(config: PostConfig, rnd: () => number) {
  for (let tries = 0; tries < 10; tries++) {
    const flopIdx = config.flop ?? Math.floor(rnd() * PF_INDEX.flops.length);
    const flop = load(config.scenario, flopIdx);
    const hero = (config.hero ?? (rnd() < 0.5 ? 0 : 1)) as 0 | 1;
    if (config.kind === "spot") {
      const nodes = spotCandidates(flop, { hero: config.hero === null ? null : hero, streets: config.streets });
      if (!nodes.length) continue;
      const nodeId = pickSpotNode(flop, nodes, 0.5, rnd);
      const node = flop.nodes[nodeId];
      const combo = pickCombo(node, rnd, () => undefined, NOW);
      const q = buildPostQuestion(flop, nodeId, combo, rnd, config.rng);
      return { flop, flopIdx, hero: node.actor as 0 | 1, combo, steps: pathSteps(flop, nodeId), q, ended: null, lastNode: nodeId };
    }
    const first = flop.nodes.find((n) => n.type === "decision" && n.actor === hero && n.street === 0 && n.data)!;
    const board = flop.board;
    const hands = first.data!.hands;
    const w = new Float64Array(hands.length);
    for (let j = 0; j < hands.length; j++) {
      const c = COMBOS[hands[j]];
      const okClass = config.heroClass === undefined || classOfCards(c.c1, c.c2) === config.heroClass;
      w[j] = okClass && !board.includes(c.c1) && !board.includes(c.c2) ? first.data!.weight[j] : 0;
    }
    const jPick = w.some((x) => x > 0) ? weightedPick(w, rnd) : weightedPick(first.data!.weight, rnd);
    const combo = hands[jPick];
    const used = [...board, COMBOS[combo].c1, COMBOS[combo].c2];
    const out = advance(flop, 0, hero, used, combo, rnd);
    const q = out.heroNode !== null ? buildPostQuestion(flop, out.heroNode, combo, rnd, config.rng) : null;
    return { flop, flopIdx, hero, combo, steps: out.steps, q, ended: out.ended, lastNode: out.lastNode };
  }
  return null;
}

/** PostSession.tsx before step 2-3: the play-through branch of `next` */
function oldNext(round: PostflopRound, nextNode: number, rnd: () => number, rng: boolean) {
  const heroCards = [COMBOS[round.combo].c1, COMBOS[round.combo].c2];
  const ctx = contextAt(round.flop, nextNode);
  const out = advance(round.flop, nextNode, round.hero, [...ctx.board, ...heroCards], round.combo, rnd);
  const q = out.heroNode !== null ? buildPostQuestion(round.flop, out.heroNode, round.combo, rnd, rng) : null;
  return { ...round, steps: out.steps, q, ended: out.ended, lastNode: out.lastNode };
}

/** PostSession.tsx before step 2-3: the `view` memo and the stacks (`edgeText` left out: the labels themselves) */
function oldView(round: PostflopRound, shown: number, phase: DrillPhase, chosenEdge: number | null) {
  const { flop } = round;
  const heroNode = round.q?.nodeId ?? round.lastNode;
  let nodeId = 0;
  if (shown > 0) {
    const s = round.steps[shown - 1];
    nodeId = s.toNode >= 0 ? s.toNode : s.nodeId;
  }
  if (phase === "asking" || phase === "answered") nodeId = heroNode;
  const ctx = contextAt(flop, nodeId);
  const node = flop.nodes[nodeId];
  const last: (EdgeLabel | null)[] = [null, null];
  let streetBets: [number, number] = ctx.streetInv;
  let foldedP: number | null = null;
  for (let i = 0; i < Math.min(shown, round.steps.length); i++) {
    const s = round.steps[i];
    if (s.card !== null) {
      last[0] = null;
      last[1] = null;
    } else if (s.label) {
      last[s.actor] = s.label;
      if (s.label.key === "fold") foldedP = s.actor;
    }
  }
  if (shown > 0 && round.steps[shown - 1].toNode < 0 && round.steps[shown - 1].label) {
    const s = round.steps[shown - 1];
    const bump = streetBets.slice() as [number, number];
    const n = flop.nodes[s.nodeId];
    const e = n.edges[s.edgeIndex];
    if (e.kind !== 0) bump[s.actor] = e.amount;
    streetBets = bump;
  }
  if (phase === "answered" && chosenEdge !== null && round.q) {
    const n = flop.nodes[round.q.nodeId];
    const e = n.edges[chosenEdge];
    last[n.actor] = labelEdge(flop, n.id, chosenEdge);
    if (e.kind === 0) foldedP = n.actor;
    else {
      const bump = streetBets.slice() as [number, number];
      bump[n.actor] = e.amount;
      streetBets = bump;
    }
  }
  const extra = streetBets[0] - ctx.streetInv[0] + (streetBets[1] - ctx.streetInv[1]);
  const stacks: [number, number] = [round.flop.stack - node.inv[0] - streetBets[0] + ctx.streetInv[0], round.flop.stack - node.inv[1] - streetBets[1] + ctx.streetInv[1]];
  return { ctx, node, last, streetBets, foldedP, pot: ctx.pot + extra, nodeId, stacks };
}

describe("post-flop question: this combo's numbers", () => {
  it("are what the one-hand solution of the bars held (frequency and EV in single precision, weight, equity, no EQR)", () => {
    let checked = 0;
    for (const flop of FLOPS) {
      for (const node of flop.nodes) {
        const d = node.data;
        if (node.type !== "decision" || !d) continue;
        for (let j = 0; j < d.n; j += 37) {
          const q = buildPostQuestion(flop, node.id, d.hands[j], mulberry32(j), false);
          // the old barSol: Float32Array(na * 169) with this combo at class index 0
          const na = node.edges.length;
          const freq = new Float32Array(na);
          const ev = new Float32Array(na);
          for (let a = 0; a < na; a++) {
            freq[a] = d.freq[a * d.n + j];
            ev[a] = d.best[j] - d.loss[a * d.n + j];
          }
          expect(q.stats.map((s) => Math.fround(s.freq))).toEqual([...freq]);
          expect(q.stats.map((s) => Math.fround(s.ev))).toEqual([...ev]);
          // grading keeps the double-precision EV (as before)
          q.stats.forEach((s, a) => expect(s.ev).toBe(d.best[j] - d.loss[a * d.n + j]));
          expect(q.weight).toBe(new Float32Array([d.weight[j]])[0]);
          expect(q.equity).toBe(new Float32Array([d.eq[j]])[0]);
          expect(q.eqr).toBeNull();
          expect(q.sol.eqr).toBeNull(); // the chart never had one either: the EQR line stays hidden post-flop
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("pre-flop question: this hand's numbers", () => {
  it("are the solution's at the hand class (what the panel read from `sol` before)", () => {
    const m = loadManifest();
    for (const nodeId of [walk(m, ""), walk(m, "FFR"), walk(m, "R")]) {
      const sol = loadNode(m, nodeId);
      for (let h = 0; h < NUM_CLASSES; h += 7) {
        const q = buildQuestion(m, nodeId, sol, h, mulberry32(h), false);
        expect(q.weight).toBe(sol.weight[h]);
        expect(q.equity).toBe(sol.equity[h]);
        expect(q.eqr).toBe(sol.eqr ? sol.eqr[h] : null);
        q.stats.forEach((s, a) => {
          expect(s.freq).toBe(sol.freq[a * NUM_CLASSES + h]);
          expect(s.ev).toBe(sol.ev[a * NUM_CLASSES + h]);
          // single precision already: the panel's Math.fround changes nothing pre-flop
          expect(Math.fround(s.ev)).toBe(s.ev);
          expect(Math.fround(s.freq)).toBe(s.freq);
        });
      }
    }
  });
});

describe("post-flop drill: keys and the time limit", () => {
  it("the shortcuts of every decision are the ones the screen had", () => {
    const d = drill();
    const keys = ["f", "c", "r", "a", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "x", "enter"];
    for (const flop of FLOPS)
      for (const node of decisions(flop)) {
        const map = d.shortcuts({ flop, q: { nodeId: node.id } } as PostflopRound);
        for (const k of keys) expect(Object.hasOwn(map, k) ? map[k] : -1, `node ${node.id} key ${k}`).toBe(oldKey(node.edges, k));
      }
  });

  it("no question, no keys", () => {
    expect(drill().shortcuts({ flop: FLOPS[0], q: null } as PostflopRound)).toEqual({});
  });

  it("the time limit folds, else checks, else takes the first action", () => {
    const d = drill();
    const seen = { fold: 0, check: 0 };
    for (const flop of FLOPS)
      for (const node of decisions(flop)) {
        const fold = node.edges.findIndex((e) => e.kind === 0);
        const chk = node.edges.findIndex((e) => e.kind === 1);
        if (fold >= 0) seen.fold++;
        else seen.check++;
        expect(d.timeout({ flop, q: { nodeId: node.id } } as PostflopRound)).toBe(fold >= 0 ? fold : chk >= 0 ? chk : 0);
      }
    expect(seen.fold).toBeGreaterThan(0);
    expect(seen.check).toBeGreaterThan(0);
    // the data always offers a fold or a check: the last resort on a made-up decision (bet sizes only)
    const odd = { flop: { nodes: [{ edges: [{ kind: 2 }, { kind: 3 }, { kind: 1 }] }, { edges: [{ kind: 2 }, { kind: 3 }] }, { edges: [{ kind: 1 }, { kind: 0 }] }] } } as unknown as PostflopRound;
    expect(d.timeout({ ...odd, q: { nodeId: 0 } as Question })).toBe(2);
    expect(d.timeout({ ...odd, q: { nodeId: 1 } as Question })).toBe(0);
    expect(d.timeout({ ...odd, q: { nodeId: 2 } as Question })).toBe(1);
  });
});

describe("post-flop drill: answers", () => {
  const endKey = (code: number) => (code === -1 ? "pf.end.fold" : code === -3 ? "pf.end.showdown" : code === -4 ? "pf.end.allin" : code === -2 ? "pf.end.pruned" : null);

  it("an answer is judged and leads where the edge goes; only a play-through names how the hand ends", () => {
    const spot = drill();
    const through = drill({ kind: "through" });
    const ends = new Set<string | null>();
    for (const flop of FLOPS)
      for (const node of decisions(flop).filter((_, i) => i % 5 === 0)) {
        const r = roundAt(flop, node.id);
        node.edges.forEach((e, i) => {
          const o = spot.answer(r, i);
          expect(o.j).toEqual(judge(r.q!, i));
          expect(o.nextNode).toBe(e.code >= 0 ? e.code : null);
          expect(o.endKey).toBeNull();
          const t = through.answer(r, i);
          expect(t.j).toEqual(o.j);
          expect(t.nextNode).toBe(o.nextNode);
          expect(t.endKey).toBe(endKey(e.code));
          ends.add(t.endKey);
        });
      }
    expect(ends).toContain("pf.end.fold");
    expect(ends).toContain("pf.end.showdown");
    expect(ends).toContain(null);
  });

  it("the settled answer is saved with the score after the hint, the time and the flags", async () => {
    for (const kind of ["spot", "through"] as const) {
      const repo = new MemoryRepo();
      const d = drill({ kind }, 3, repo);
      const r = (await d.start())!;
      expect(r.q).not.toBeNull();
      const o = d.answer(r, 0);
      d.record(r, settle(o, { score: 12, ms: 4321, timeout: true, hint: true }));
      await new Promise((res) => setTimeout(res, 0));
      const [att] = await repo.allAttempts();
      expect(att).toMatchObject({ mode: kind === "spot" ? "postSpot" : "post", nodeId: r.q!.nodeId, hand: r.combo, chosen: 0, best: o.j.bestIndex, grade: o.j.grade, evLoss: o.j.evLoss, score: 12, ms: 4321, timeout: true, hint: true, rng: false, build: r.flop.build, ts: NOW });
      expect(att.sessionId).toMatch(/^p-/);
      expect(await repo.allSrs()).toHaveLength(1);
      // the same session id for the next answer
      d.record(r, settle(o));
      await new Promise((res) => setTimeout(res, 0));
      expect(new Set((await repo.allAttempts()).map((a) => a.sessionId)).size).toBe(1);
    }
  });
});

describe("post-flop drill: dealing", () => {
  const configs: Partial<PostConfig>[] = [
    {},
    { hero: 0, streets: [1] },
    { hero: 1, streets: [2], rng: true },
    { flop: 2, streets: [0] },
    { scenario: "3bp-btn-bb", streets: [0, 2] },
    { kind: "through" },
    { kind: "through", hero: 0, rng: true },
    { kind: "through", hero: 1, flop: 3 },
    { kind: "through", hero: 0, heroClass: classByName("98s") }, // continued from a pre-flop hand
    { kind: "through", hero: 0, heroClass: classByName("AA") }, // not in the big blind's flatting range: any combo of the range
    { kind: "through", scenario: "srp-co-bb" },
  ];

  it("deals what the screen dealt (the same random numbers in the same order)", async () => {
    let asked = 0;
    for (const [ci, c] of configs.entries())
      for (let seed = 1; seed <= 6; seed++) {
        const config = { ...CONFIG, ...c };
        const got = await drill(c, seed * 31 + ci).start();
        const want = oldStart(config, mulberry32(seed * 31 + ci));
        expect(got).toEqual(want);
        if (got?.q) asked++;
        if (got && config.heroClass === classByName("98s")) expect(classOfCards(COMBOS[got.combo].c1, COMBOS[got.combo].c2)).toBe(config.heroClass);
      }
    expect(asked).toBeGreaterThan(40);
  });

  it("a spot drill with no matching decision is empty; so is a missing index", async () => {
    expect(await drill({ streets: [] }).start()).toBeNull();
    const d = createPostflopDrill({ config: CONFIG, repo: new MemoryRepo(), rnd: mulberry32(1), index: () => Promise.reject(new Error("offline")), flop: async (s, f) => load(s, f) });
    expect(await d.start()).toBeNull();
  });

  it("a spot drill deals a new hand after an answer; a play-through goes on with the same hand", async () => {
    const spot = drill({}, 5);
    const r = (await spot.start())!;
    const goesOn = r.flop.nodes[r.q!.nodeId].edges.findIndex((e) => e.code >= 0);
    expect(await spot.next(r, settle(spot.answer(r, goesOn)))).toBeNull();

    let continued = 0;
    let ended = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const d = drill({ kind: "through" }, seed);
      let round = (await d.start())!;
      for (let street = 0; street < 6 && round.q; street++) {
        const edges = round.flop.nodes[round.q.nodeId].edges;
        const pick = seed % 2 ? edges.findIndex((e) => e.kind === 1) : edges.length - 1;
        const a = settle(d.answer(round, pick));
        if (a.nextNode === null) {
          expect(await d.next(round, a)).toBeNull();
          ended++;
          break;
        }
        // the same random numbers as the old screen used after the answer
        const probe = mulberry32(seed * 1000 + street);
        const d2 = createPostflopDrill({ config: { ...CONFIG, kind: "through" }, repo: new MemoryRepo(), rnd: probe, index: async () => PF_INDEX, flop: async (s, f) => load(s, f) });
        const got = (await d2.next(round, a))!;
        expect(got).toEqual(oldNext(round, a.nextNode, mulberry32(seed * 1000 + street), false));
        expect(got.combo).toBe(round.combo);
        expect(got.hero).toBe(round.hero);
        expect(got.flop).toBe(round.flop);
        // dealt cards never repeat the board or the hero's cards
        const board = contextAt(got.flop, a.nextNode).board;
        for (const s of got.steps) if (s.card !== null) expect([...board, COMBOS[got.combo].c1, COMBOS[got.combo].c2]).not.toContain(s.card);
        round = got;
        continued++;
      }
    }
    expect(continued).toBeGreaterThan(10);
    expect(ended).toBeGreaterThan(0);
  });
});

describe("post-flop drill: the table", () => {
  it("shows at every step what the screen showed", async () => {
    const phases: DrillPhase[] = ["animating", "asking", "answered", "handEnd", "loading"];
    let checked = 0;
    const rounds: PostflopRound[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      rounds.push((await drill({}, seed).start())!);
      const d = drill({ kind: "through" }, seed);
      const r = (await d.start())!;
      rounds.push(r);
      if (r.q) {
        const edges = r.flop.nodes[r.q.nodeId].edges;
        const a = settle(d.answer(r, edges.findIndex((e) => e.kind === 1)));
        if (a.nextNode !== null) rounds.push((await d.next(r, a))!);
      }
    }
    for (const r of rounds)
      for (let shown = 0; shown <= r.steps.length; shown++)
        for (const phase of phases) {
          const chosen: (number | null)[] = phase === "answered" && r.q ? r.flop.nodes[r.q.nodeId].edges.map((_, i) => i) : [null];
          for (const c of chosen) {
            expect(postTableView(r, shown, phase, c)).toEqual(oldView(r, shown, phase, c));
            checked++;
          }
        }
    expect(checked).toBeGreaterThan(200);
    // a fold ends a hand on the table: the folded player and the moves are shown
    const folds = rounds.filter((r) => r.steps.some((s: PStep) => s.label?.key === "fold"));
    for (const r of folds) expect(postTableView(r, r.steps.length, "handEnd", null).foldedP).not.toBeNull();
  });
});
