import { classInfo, NUM_CLASSES } from "../poker/hands";
import { gradeAnswer } from "../practice/grading";
import type { ActionStat, Grade } from "../practice/grading";
import { formatRange } from "../ranges/range";
import { ActionKind } from "../solution/types";
import type { Manifest, NodeSolution, SpotType } from "../solution/types";
import { spotType } from "../solution/tree";
import type { NormAction, NormHand } from "./normalize";

export interface SolutionSource {
  manifest: Manifest;
  node(id: number): Promise<NodeSolution>;
}

/** hands whose effective stack is outside this range (bb) are not graded: below ~15bb it is push/fold, above 250bb it is a different game */
export const MIN_STACK = 15;
export const MAX_STACK = 250;

/** the stack that matters in a hand: the hero's, capped by the deepest opponent (nobody can win or lose more than that) */
export function effectiveStack(hand: NormHand): number {
  const others = hand.stacks.filter((s, i) => s > 0 && i !== hand.heroSeat);
  return Math.min(hand.stacks[hand.heroSeat], others.length ? Math.max(...others) : Infinity);
}
/** a raise this much bigger/smaller than the solution's single raise size is flagged as an approximation */
const SIZE_TOLERANCE = 1.35;

export interface DecisionInfo {
  nodeId: number;
  seat: number;
  spot: SpotType;
  handClass: number;
  chosen: number;
  chosenKind: ActionKind;
  /** per action of the node: frequency of the hero's hand and its EV (bb) */
  stats: ActionStat[];
  best: number;
  evLoss: number;
  grade: Grade;
  score: number;
  /** real raise-to size vs the solution's, when they differ a lot */
  sizeNote: { real: number; tree: number } | null;
}

export interface OffTree {
  seat: number;
  what: string;
}

export interface FlopLink {
  board: number[];
  oopSeat: number;
  ipSeat: number;
  oopText: string;
  ipText: string;
  pot: number;
  stack: number;
}

export interface HandAnalysis {
  id: string;
  /** id of the solution the node ids refer to (absent in hands analysed before depths existed: 100bb) */
  solution?: string;
  status: "ok" | "partial" | "skipped";
  reason?: string;
  decisions: DecisionInfo[];
  offTree: OffTree[];
  /** summed EV loss of the graded preflop decisions (bb) */
  evLoss: number;
  worst: DecisionInfo | null;
  flopLink: FlopLink | null;
}

/** acts first after the flop: SB, BB, UTG, HJ, CO, BTN */
const POSTFLOP_ORDER = [2, 3, 4, 5, 0, 1] as const;
export const postflopRank = (seat: number) => POSTFLOP_ORDER[seat];

function actionIndex(m: Manifest, nodeId: number, act: NormAction, stack: number): { index: number; sizeNote: DecisionInfo["sizeNote"] } | null {
  const acts = m.nodes[nodeId].actions;
  const find = (kind: ActionKind) => acts.findIndex((a) => a.kind === kind);
  if (act.kind === "fold") {
    const i = find(ActionKind.Fold);
    return i < 0 ? null : { index: i, sizeNote: null };
  }
  if (act.kind === "check" || act.kind === "call") {
    const i = find(ActionKind.Call);
    return i < 0 ? null : { index: i, sizeNote: null };
  }
  const raise = find(ActionKind.Raise);
  const allIn = find(ActionKind.AllIn);
  const jam = act.allIn || act.bb >= 0.9 * stack;
  if (jam && allIn >= 0) return { index: allIn, sizeNote: null };
  if (raise >= 0) {
    const tree = acts[raise].to;
    const ratio = act.bb / tree;
    return { index: raise, sizeNote: ratio > SIZE_TOLERANCE || ratio < 1 / SIZE_TOLERANCE ? { real: act.bb, tree } : null };
  }
  if (allIn >= 0) return { index: allIn, sizeNote: null };
  return null;
}

/**
 * Walk the hero's preflop line through the solution and grade every hero decision by EV loss.
 * Raise sizes are mapped to the solution's single raise size (and the all-in); a size that differs a lot is flagged.
 */
export async function analyzeHand(src: SolutionSource, hand: NormHand): Promise<HandAnalysis> {
  const m = src.manifest;
  const base: HandAnalysis = { id: hand.id, solution: src.manifest.id, status: "ok", decisions: [], offTree: [], evLoss: 0, worst: null, flopLink: null };
  const skip = (reason: string): HandAnalysis => ({ ...base, status: "skipped", reason });
  const eff = effectiveStack(hand);
  if (eff < MIN_STACK || eff > MAX_STACK) return skip(`effective stack ${eff.toFixed(0)}bb is outside ${MIN_STACK}-${MAX_STACK}bb`);
  if (hand.names.filter(Boolean).length < 2) return skip("fewer than two players");

  const last = new Map<number, { nodeId: number; action: number }>();
  let node = 0;
  let broken: string | null = null;
  let ended = false;
  const pre = hand.actions.filter((a) => a.street === 0);

  for (const act of pre) {
    // seats nobody sits on have folded
    for (let guard = 0; guard < 6 && !hand.names[m.nodes[node].actor]; guard++) {
      const f = m.nodes[node].actions.findIndex((a) => a.kind === ActionKind.Fold);
      if (f < 0 || m.nodes[node].actions[f].child < 0) break;
      node = m.nodes[node].actions[f].child;
    }
    const meta = m.nodes[node];
    if (meta.actor !== act.seat) {
      broken = "the action order differs from the solution";
      break;
    }
    const pick = actionIndex(m, node, act, hand.stacks[act.seat]);
    if (!pick) {
      if (act.seat === hand.heroSeat) base.offTree.push({ seat: act.seat, what: `${act.kind} ${act.bb.toFixed(1)}bb` });
      broken = `${act.kind} is not part of the solution at this point`;
      break;
    }
    last.set(act.seat, { nodeId: node, action: pick.index });
    if (act.seat === hand.heroSeat) {
      const sol = await src.node(node);
      const h = hand.heroClass;
      const stats: ActionStat[] = meta.actions.map((_, a) => ({ freq: sol.freq[a * NUM_CLASSES + h], ev: sol.ev[a * NUM_CLASSES + h] }));
      const g = gradeAnswer(stats, pick.index);
      base.decisions.push({
        nodeId: node,
        seat: act.seat,
        spot: spotType(m, node),
        handClass: h,
        chosen: pick.index,
        chosenKind: meta.actions[pick.index].kind,
        stats,
        best: g.bestIndex,
        evLoss: g.evLoss,
        grade: g.grade,
        score: g.score,
        sizeNote: pick.sizeNote,
      });
    }
    const child = meta.actions[pick.index].child;
    if (child < 0) {
      ended = true;
      break;
    }
    node = child;
  }

  base.evLoss = base.decisions.reduce((s, d) => s + d.evLoss, 0);
  base.worst = base.decisions.reduce<DecisionInfo | null>((w, d) => (!w || d.evLoss > w.evLoss ? d : w), null);
  if (broken) {
    base.status = base.decisions.length ? "partial" : "skipped";
    base.reason = broken;
  }

  // heads-up flop: reconstruct both ranges from the line, so the spot can be solved on the Solve screen
  if (!broken && ended && hand.flop && hand.flop.seats.length === 2 && hand.board.length >= 3) {
    const [a, b] = hand.flop.seats;
    const [oop, ip] = postflopRank(a) < postflopRank(b) ? [a, b] : [b, a];
    const ranges = await Promise.all(
      [oop, ip].map(async (s) => {
        const l = last.get(s);
        if (!l) return null;
        const sol = await src.node(l.nodeId);
        const r = new Float32Array(NUM_CLASSES);
        for (let h = 0; h < NUM_CLASSES; h++) r[h] = sol.weight[h] * sol.freq[l.action * NUM_CLASSES + h];
        return r;
      }),
    );
    const stack = Math.min(hand.flop.stacks[a], hand.flop.stacks[b]);
    // nothing left to play with (all-in before the flop) -> no spot to solve
    if (ranges[0] && ranges[1] && stack >= 1) {
      base.flopLink = {
        board: hand.board.slice(0, 3),
        oopSeat: oop,
        ipSeat: ip,
        oopText: formatRange(ranges[0]),
        ipText: formatRange(ranges[1]),
        pot: Math.round(hand.flop.pot * 100) / 100,
        stack: Math.round(stack * 100) / 100,
      };
    }
  }
  return base;
}

export { classInfo };
