import { NUM_CLASSES, Card, comboCount, randomCombo } from "../poker/hands";
import { actionForRoll, ActionStat, gradeAnswer, GradeResult } from "./grading";
import { applyAction, initialState, stateAt } from "../solution/tree";
import { ActionKind, Terminal } from "../solution/types";
import type { ActionMeta, Manifest, NodeSolution, PublicState } from "../solution/types";
import { weightedPick } from "../util/rng";

const K = NUM_CLASSES;

export interface NodeSource {
  manifest: Manifest;
  node(id: number): Promise<NodeSolution>;
}

export interface PendingStep {
  actor: number;
  actionIndex: number;
  action: ActionMeta;
  before: PublicState;
  after: PublicState;
}

/** sample the hand class an opponent holds at a node: proportional to combos * range weight */
export function sampleHandClass(sol: NodeSolution, rnd: () => number): number {
  const w = new Float64Array(K);
  for (let h = 0; h < K; h++) w[h] = comboCount(h) * sol.weight[h];
  return weightedPick(w, rnd);
}

export function sampleAction(sol: NodeSolution, h: number, rnd: () => number): number {
  const f = new Float64Array(sol.na);
  for (let a = 0; a < sol.na; a++) f[a] = sol.freq[a * K + h];
  return weightedPick(f, rnd);
}

export interface PlayOut {
  steps: PendingStep[];
  /** the next decision of the hero, or null if the hand ended */
  heroNode: number | null;
  /** how the hand ended (Terminal code) or -2 when the line leaves the solved tree */
  ended: Terminal | -2 | null;
  state: PublicState;
}

/**
 * Let the opponents act (sampling their hands and actions from the solution)
 * starting at `start` until the hero must decide or the hand ends.
 */
export async function playOutOpponents(src: NodeSource, start: number, hero: number, rnd: () => number): Promise<PlayOut> {
  const m = src.manifest;
  const steps: PendingStep[] = [];
  let node = start;
  let state = stateAt(m, start);
  for (let guard = 0; guard < 40; guard++) {
    const meta = m.nodes[node];
    if (meta.actor === hero) return { steps, heroNode: node, ended: null, state };
    const sol = await src.node(node);
    const h = sampleHandClass(sol, rnd);
    const ai = sampleAction(sol, h, rnd);
    const action = meta.actions[ai];
    const after = applyAction(state, meta.actor, action);
    steps.push({ actor: meta.actor, actionIndex: ai, action, before: state, after });
    state = after;
    if (action.child < 0) return { steps, heroNode: null, ended: action.child === -2 ? -2 : action.term, state };
    node = action.child;
  }
  return { steps, heroNode: null, ended: -2, state };
}

/** the steps that lead to `nodeId` (for spot drills the table replays them) */
export function stepsTo(m: Manifest, nodeId: number): PendingStep[] {
  const out: PendingStep[] = [];
  const path: number[] = [];
  for (let cur = nodeId; cur >= 0; cur = m.nodes[cur].parent) path.push(cur);
  path.reverse();
  let s = initialState(m);
  for (let i = 0; i < path.length - 1; i++) {
    const meta = m.nodes[path[i]];
    const ai = m.nodes[path[i + 1]].parentAction;
    const action = meta.actions[ai];
    const after = applyAction(s, meta.actor, action);
    out.push({ actor: meta.actor, actionIndex: ai, action, before: s, after });
    s = after;
  }
  return out;
}

export interface Question {
  nodeId: number;
  hand: number;
  cards: [Card, Card];
  sol: NodeSolution;
  stats: ActionStat[];
  /** rng mode: roll in [0,1) and the action it prescribes */
  roll: number | null;
  rngAction: number | null;
  /** call price vs pot for the explanation (null when no chips are needed) */
  potOdds: { call: number; pot: number; need: number } | null;
}

/** action order used to lay frequencies along a roll: raises first, then call, then fold */
export function rngOrder(actions: ActionMeta[]): number[] {
  const rank = (k: ActionKind) => (k === ActionKind.AllIn ? 0 : k === ActionKind.Raise ? 1 : k === ActionKind.Call ? 2 : 3);
  return actions.map((_, i) => i).sort((a, b) => rank(actions[a].kind) - rank(actions[b].kind));
}

export function buildQuestion(m: Manifest, nodeId: number, sol: NodeSolution, hand: number, rnd: () => number, rng: boolean): Question {
  const stats: ActionStat[] = Array.from({ length: sol.na }, (_, a) => ({ freq: sol.freq[a * K + hand], ev: sol.ev[a * K + hand] }));
  let roll: number | null = null;
  let rngAction: number | null = null;
  if (rng) {
    roll = rnd();
    rngAction = actionForRoll(
      stats.map((s) => s.freq),
      rngOrder(m.nodes[nodeId].actions),
      roll,
    );
  }
  const st = stateAt(m, nodeId);
  const toCall = st.cur - st.inv[m.nodes[nodeId].actor];
  const potOdds = toCall > 1e-9 ? { call: toCall, pot: st.pot + toCall, need: toCall / (st.pot + toCall) } : null;
  return { nodeId, hand, cards: randomCombo(hand, rnd), sol, stats, roll, rngAction, potOdds };
}

export interface Judgement extends GradeResult {
  chosen: number;
  rngMiss: boolean;
}

/** grade an answer; in RNG mode ignoring the roll caps the grade at "inaccurate" */
export function judge(q: Question, chosen: number): Judgement {
  const base = gradeAnswer(q.stats, chosen);
  const rngMiss = q.rngAction !== null && chosen !== q.rngAction;
  if (rngMiss && (base.grade === "best" || base.grade === "correct")) {
    return { ...base, grade: "inaccurate", score: Math.min(base.score, 60), chosen, rngMiss };
  }
  return { ...base, chosen, rngMiss };
}

/** keyboard shortcut label per action: F / C / R (first raise), A for all-in */
export function shortcutFor(a: ActionMeta, indexAmongRaises: number): string {
  switch (a.kind) {
    case ActionKind.Fold:
      return "F";
    case ActionKind.Call:
      return "C";
    case ActionKind.AllIn:
      return "A";
    default:
      return indexAmongRaises === 0 ? "R" : String(indexAmongRaises + 1);
  }
}
