import { DEFAULT_SOLUTION } from "../solution/loader";
import type { Manifest } from "../solution/types";
import { currentPreflopNode } from "./position";
import { isDue } from "./srs";
import type { SrsItem } from "./srs";

/**
 * One pre-flop decision to ask again: the hand class and the decision. With `pos` (a position key) the node id is
 * looked up again when the round starts (resolveItems); without it the stored node id is used.
 */
export interface ReviewItem {
  nodeId: number;
  hand: number;
  pos?: string;
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

/**
 * The spaced-repetition key of a pre-flop decision: `<node>:<hand>` for the 100bb solution, `<solution>:<node>:<hand>`
 * for the others (lib/practice/srs.ts). Post-flop keys (`p:…`) and anything else are not pre-flop reviews.
 */
export function parseSrsKey(key: string): { solution: string; nodeId: number; hand: number } | null {
  let m = /^(\d+):(\d+)$/.exec(key);
  if (m) return { solution: DEFAULT_SOLUTION, nodeId: Number(m[1]), hand: Number(m[2]) };
  m = /^(cash6max-\d+bb):(\d+):(\d+)$/.exec(key);
  if (m) return { solution: m[1], nodeId: Number(m[2]), hand: Number(m[3]) };
  return null;
}

const PREFLOP_SOLUTION = /^cash6max-\d+bb$/;

/** what a spaced-repetition item asks again, if it is a pre-flop decision: by its position when it has one, else by its old key */
function reviewOf(it: SrsItem): ({ solution: string } & ReviewItem) | null {
  if (it.pos !== undefined && it.solution !== undefined) return PREFLOP_SOLUTION.test(it.solution) ? { solution: it.solution, nodeId: it.nodeId, hand: it.hand, pos: it.pos } : null;
  return parseSrsKey(it.key);
}

/**
 * The questions of a prepared list in manifest `m`: an item with a position key gets the node id that position has
 * now; one whose position this solution does not have is left out (it cannot be asked).
 */
export function resolveItems(m: Manifest, items: readonly ReviewItem[]): { nodeId: number; hand: number }[] {
  const out: { nodeId: number; hand: number }[] = [];
  for (const it of items) {
    const nodeId = currentPreflopNode(m, it);
    if (nodeId !== null) out.push({ nodeId, hand: it.hand });
  }
  return out;
}

const depthOfSolution = (id: string) => Number(/(\d+)bb$/.exec(id)?.[1] ?? 0);

/** what is due now: per depth, the longest overdue and the most often missed first, at most REVIEW_ROUND to a round */
export function dueReview(all: SrsItem[], now: number, round = REVIEW_ROUND): ReviewQueue {
  const bySolution = new Map<string, SrsItem[]>();
  for (const it of all) {
    if (!isDue(it, now)) continue;
    const k = reviewOf(it);
    if (!k || !(k.hand >= 0 && k.hand < 169)) continue;
    const list = bySolution.get(k.solution);
    if (list) list.push(it);
    else bySolution.set(k.solution, [it]);
  }
  const groups: ReviewGroup[] = [...bySolution].map(([solution, list]) => {
    const sorted = [...list].sort((a, b) => a.due - b.due || b.lapses - a.lapses);
    const items = sorted.slice(0, round).map((it): ReviewItem => {
      const k = reviewOf(it)!;
      return k.pos === undefined ? { nodeId: k.nodeId, hand: k.hand } : { nodeId: k.nodeId, hand: k.hand, pos: k.pos };
    });
    return { solution, due: list.length, items };
  });
  groups.sort((a, b) => b.due - a.due || depthOfSolution(a.solution) - depthOfSolution(b.solution));
  return { total: groups.reduce((s, g) => s + g.due, 0), groups };
}

/** the id of the question list a review round is stored under (`practiceSet:review`, read by the Practice screen) */
export const REVIEW_SET_ID = "review";
