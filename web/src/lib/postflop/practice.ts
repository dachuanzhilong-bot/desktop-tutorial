import { NUM_CLASSES } from "../poker/hands";
import type { Card } from "../poker/hands";
import type { Question } from "../practice/engine";
import { mixedness, priorityWeight, SrsItem } from "../practice/srs";
import { actionForRoll, ActionStat } from "../practice/grading";
import type { NodeSolution } from "../solution/types";
import { weightedPick } from "../util/rng";
import { toClassSolution } from "./aggregate";
import { COMBOS, NC, cardOf, classOfCards } from "./combos";
import { dense, PfFlop, PfNode } from "./decode";
import { contextAt, labelEdge, EdgeLabel } from "./replay";

/** one animated event on the postflop table */
export interface PStep {
  /** node the event happens at */
  nodeId: number;
  edgeIndex: number;
  /** player who acts (decision) or -1 for a dealt card */
  actor: number;
  /** the node that is reached afterwards (-1 when the hand ends) */
  toNode: number;
  label: EdgeLabel | null;
  card: number | null;
}

export const heroOf = (flop: PfFlop, nodeId: number) => flop.nodes[nodeId].actor;

const conflicts = (combo: number, used: number[]) => used.includes(COMBOS[combo].c1) || used.includes(COMBOS[combo].c2);

/** sample the opponent's hand at a node (weights come from the solution; blockers are respected) */
export function sampleHand(node: PfNode, used: number[], rnd: () => number): number | null {
  const d = node.data;
  if (!d) return null;
  const w = new Float64Array(d.n);
  for (let j = 0; j < d.n; j++) w[j] = conflicts(d.hands[j], used) ? 0 : d.weight[j];
  let total = 0;
  for (let j = 0; j < d.n; j++) total += w[j];
  if (total <= 0) return null;
  return d.hands[weightedPick(w, rnd)];
}

export function sampleEdge(node: PfNode, combo: number, rnd: () => number): number {
  const d = node.data!;
  const j = d.hands.indexOf(combo);
  const na = node.edges.length;
  const f = new Float64Array(na);
  for (let a = 0; a < na; a++) f[a] = d.freq[a * d.n + j];
  return weightedPick(f, rnd);
}

export type PEnd = "fold" | "showdown" | "allin" | "unsolved" | "absent" | null;

export interface PAdvance {
  steps: PStep[];
  /** the hero's next decision, if any */
  heroNode: number | null;
  ended: PEnd;
  /** last node reached (for the table) */
  lastNode: number;
}

const endOf = (code: number): PEnd => (code === -1 ? "fold" : code === -3 ? "showdown" : code === -4 ? "allin" : "unsolved");

/**
 * Play the opponent's moves (and deal the cards) from `start` until the hero must act or the hand ends.
 * `used` = cards that must not appear (hero's hole cards + the board).
 */
export function advance(flop: PfFlop, start: number, hero: number, used: number[], heroCombo: number, rnd: () => number): PAdvance {
  const steps: PStep[] = [];
  let id = start;
  for (let guard = 0; guard < 40; guard++) {
    const node = flop.nodes[id];
    if (node.type === "chance") {
      const ok = node.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.code >= 0 && !used.includes(e.kind));
      if (!ok.length) return { steps, heroNode: null, ended: "unsolved", lastNode: id };
      const pick = ok[Math.floor(rnd() * ok.length)];
      steps.push({ nodeId: id, edgeIndex: pick.i, actor: -1, toNode: pick.e.code, label: null, card: pick.e.kind });
      used = [...used, pick.e.kind];
      id = pick.e.code;
      continue;
    }
    if (node.actor === hero) {
      if (node.data!.hands.indexOf(heroCombo) < 0) return { steps, heroNode: null, ended: "absent", lastNode: id };
      return { steps, heroNode: id, ended: null, lastNode: id };
    }
    const hand = sampleHand(node, used, rnd);
    if (hand === null) return { steps, heroNode: null, ended: "unsolved", lastNode: id };
    const ei = sampleEdge(node, hand, rnd);
    const e = node.edges[ei];
    steps.push({ nodeId: id, edgeIndex: ei, actor: node.actor, toNode: e.code, label: labelEdge(flop, id, ei), card: null });
    if (e.code < 0) return { steps, heroNode: null, ended: endOf(e.code), lastNode: id };
    id = e.code;
  }
  return { steps, heroNode: null, ended: "unsolved", lastNode: id };
}

/** the path from the root to `nodeId` as animation steps (spot drills replay the whole line) */
export function pathSteps(flop: PfFlop, nodeId: number): PStep[] {
  const out: PStep[] = [];
  const chain: number[] = [];
  for (let c = nodeId; c >= 0; c = flop.nodes[c].parent) chain.push(c);
  chain.reverse();
  for (let i = 0; i < chain.length - 1; i++) {
    const n = flop.nodes[chain[i]];
    const ei = flop.nodes[chain[i + 1]].parentEdge;
    const e = n.edges[ei];
    out.push(n.type === "chance" ? { nodeId: n.id, edgeIndex: ei, actor: -1, toNode: chain[i + 1], label: null, card: e.kind } : { nodeId: n.id, edgeIndex: ei, actor: n.actor, toNode: chain[i + 1], label: labelEdge(flop, n.id, ei), card: null });
  }
  return out;
}

/** candidate decision nodes for a spot drill */
export function spotCandidates(flop: PfFlop, opts: { hero: number | null; streets: number[]; minReach?: number }): number[] {
  return flop.nodes.filter((n) => n.type === "decision" && n.data && n.reach >= (opts.minReach ?? 0.01) && (opts.hero === null || n.actor === opts.hero) && opts.streets.includes(n.street)).map((n) => n.id);
}

export function pickSpotNode(flop: PfFlop, nodes: number[], flatten: number, rnd: () => number): number {
  return nodes[weightedPick(nodes.map((id) => Math.pow(flop.nodes[id].reach, 1 - flatten)), rnd)];
}

/** `itemOf`: the spaced-repetition item of a combo at this node (looked up by position, see SrsIndex.find) */
export function pickCombo(node: PfNode, rnd: () => number, itemOf: (combo: number) => SrsItem | undefined, now: number): number {
  const d = node.data!;
  const na = node.edges.length;
  const w = new Float64Array(d.n);
  for (let j = 0; j < d.n; j++) {
    if (d.weight[j] < 0.02) continue;
    const fr = new Float32Array(na);
    for (let a = 0; a < na; a++) fr[a] = d.freq[a * d.n + j];
    w[j] = d.weight[j] * priorityWeight({ item: itemOf(d.hands[j]), now, mixedness: mixedness(fr), mixedBoost: true });
  }
  return d.hands[weightedPick(w, rnd)];
}

/** Question object (same shape as the preflop one) for the hero's combo at a postflop node */
export function buildPostQuestion(flop: PfFlop, nodeId: number, combo: number, rnd: () => number, rng: boolean): Question {
  const node = flop.nodes[nodeId];
  const d = node.data!;
  const j = d.hands.indexOf(combo);
  const na = node.edges.length;
  const stats: ActionStat[] = Array.from({ length: na }, (_, a) => ({ freq: d.freq[a * d.n + j], ev: d.best[j] - d.loss[a * d.n + j] }));
  let roll: number | null = null;
  let rngAction: number | null = null;
  if (rng) {
    roll = rnd();
    // order: all-in / raises first, then call/check, then fold
    const rank = (k: number) => (k === 3 ? 0 : k === 2 ? 1 : k === 1 ? 2 : 3);
    const order = node.edges.map((_, i) => i).sort((a, b) => rank(node.edges[a].kind) - rank(node.edges[b].kind));
    rngAction = actionForRoll(
      stats.map((s) => s.freq),
      order,
      roll,
    );
  }
  const ctx = contextAt(flop, nodeId);
  const potOdds = ctx.toCall > 1e-9 ? { call: ctx.toCall, pot: ctx.potNow + ctx.toCall, need: ctx.toCall / (ctx.potNow + ctx.toCall) } : null;
  const dn = dense(node)!;
  const grid = toClassSolution(nodeId, dn);
  // synthetic one-hand solution for the frequency bars (hand index 0)
  const barSol: NodeSolution = { id: nodeId, na, weight: new Float32Array(NUM_CLASSES), equity: new Float32Array(NUM_CLASSES), freq: new Float32Array(na * NUM_CLASSES), ev: new Float32Array(na * NUM_CLASSES), eqr: null };
  barSol.weight[0] = d.weight[j];
  barSol.equity[0] = d.eq[j];
  for (let a = 0; a < na; a++) {
    barSol.freq[a * NUM_CLASSES] = stats[a].freq;
    barSol.ev[a * NUM_CLASSES] = stats[a].ev;
  }
  const c = COMBOS[combo];
  const cards: [Card, Card] = [cardOf(c.c1), cardOf(c.c2)];
  return { nodeId, hand: classOfCards(c.c1, c.c2), cards, sol: grid, stats, roll, rngAction, potOdds, bars: { sol: barSol, h: 0 } };
}

/** key of a post-flop spaced-repetition item made before position keys existed (it holds the flop's index and the node id) */
export const legacyPostSrsKey = (scenario: string, flopIndex: number, nodeId: number, combo: number) => `p:${scenario}/${flopIndex}:${nodeId}:${combo}`;

export { NC };
