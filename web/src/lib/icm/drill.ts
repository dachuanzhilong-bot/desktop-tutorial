import { classInfo, NUM_CLASSES } from "../poker/hands";
import { gradeAnswer } from "../practice/grading";
import type { GradeResult } from "../practice/grading";
import { weightedPick } from "../util/rng";
import type { IcmNode, IcmSolution } from "./model";

export interface IcmQuestion {
  node: IcmNode;
  hand: number;
}

/**
 * A random decision of `player` (a jam/fold decision or a call/fold decision after somebody's jam) and a hand,
 * both drawn as often as they actually occur in the equilibrium (node reach, then the hand's weight x combos).
 */
export function pickIcmQuestion(sol: IcmSolution, player: number, rnd: () => number): IcmQuestion | null {
  const nodes = sol.nodes.filter((n) => n.player === player && n.reach > 1e-6);
  if (!nodes.length) return null;
  const node = nodes[weightedPick(nodes.map((n) => n.reach), rnd)];
  const w = new Float64Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) w[h] = node.weight[h] >= 0.02 ? node.weight[h] * classInfo(h).combos : 0;
  if (!w.some((x) => x > 0)) return null;
  return { node, hand: weightedPick(w, rnd) };
}

export interface IcmJudgement extends GradeResult {
  /** 0 = fold, 1 = jam / call */
  chosen: 0 | 1;
  /** what the solution does with this hand: probability of jamming (calling) */
  actFreq: number;
  evAct: number;
  evFold: number;
}

/**
 * Same five grades as the chip-EV practice, with the loss measured in % of the prize pool
 * (best <= 0.005, correct <= 0.05 or a mix >= 10 %, inaccurate <= 0.2, mistake <= 0.6, blunder above).
 */
export function judgeIcm(q: IcmQuestion, act: boolean): IcmJudgement {
  const h = q.hand;
  const actFreq = q.node.freq[h];
  const evAct = q.node.evAct[h];
  const evFold = q.node.evFold[h];
  const stats = [
    { freq: 1 - actFreq, ev: evFold },
    { freq: actFreq, ev: evAct },
  ];
  const chosen = act ? 1 : 0;
  return { ...gradeAnswer(stats, chosen), chosen, actFreq, evAct, evFold };
}
