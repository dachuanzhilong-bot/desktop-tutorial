import type { Manifest } from "../solution/types";
import { currentPreflopNode } from "./position";
import { isDue } from "./srs";
import type { SrsItem } from "./srs";

/** one pre-flop decision to ask again: the hand class and the decision's position key (the node is looked up when the round starts: resolveItems) */
export interface ReviewItem {
  pos: string;
  hand: number;
}

/** due reviews of one solution (stack depth): `items` is what a review round asks, `due` all that are due there */
export interface ReviewGroup {
  solution: string;
  due: number;
  items: ReviewItem[];
}

export interface ReviewQueue {
  /** pre-flop reviews that are due, in all depths */
  total: number;
  /** largest group first */
  groups: ReviewGroup[];
}

/** questions in one review round */
export const REVIEW_ROUND = 20;

const PREFLOP_SOLUTION = /^cash6max-\d+bb$/;

/** a spaced-repetition item of a pre-flop decision (post-flop items are not reviewed here) */
const isPreflopReview = (it: SrsItem) => PREFLOP_SOLUTION.test(it.solution) && it.hand >= 0 && it.hand < 169;

/**
 * The questions of a prepared list in manifest `m`: each item gets the node id its position has now; one whose
 * position this solution does not have is left out (it cannot be asked).
 */
export function resolveItems(m: Manifest, items: readonly ReviewItem[]): { nodeId: number; hand: number }[] {
  const out: { nodeId: number; hand: number }[] = [];
  for (const it of items) {
    const nodeId = typeof it.pos === "string" ? currentPreflopNode(m, it) : null;
    if (nodeId !== null) out.push({ nodeId, hand: it.hand });
  }
  return out;
}

const depthOfSolution = (id: string) => Number(/(\d+)bb$/.exec(id)?.[1] ?? 0);

/** what is due now: per depth, the longest overdue and the most often missed first, at most REVIEW_ROUND to a round */
export function dueReview(all: SrsItem[], now: number, round = REVIEW_ROUND): ReviewQueue {
  const bySolution = new Map<string, SrsItem[]>();
  for (const it of all) {
    if (!isDue(it, now) || !isPreflopReview(it)) continue;
    const list = bySolution.get(it.solution);
    if (list) list.push(it);
    else bySolution.set(it.solution, [it]);
  }
  const groups: ReviewGroup[] = [...bySolution].map(([solution, list]) => {
    const sorted = [...list].sort((a, b) => a.due - b.due || b.lapses - a.lapses);
    return { solution, due: list.length, items: sorted.slice(0, round).map((it): ReviewItem => ({ pos: it.pos, hand: it.hand })) };
  });
  groups.sort((a, b) => b.due - a.due || depthOfSolution(a.solution) - depthOfSolution(b.solution));
  return { total: groups.reduce((s, g) => s + g.due, 0), groups };
}

/** the id of the question list a review round is stored under (`practiceSet:review`, read by the Practice screen) */
export const REVIEW_SET_ID = "review";
