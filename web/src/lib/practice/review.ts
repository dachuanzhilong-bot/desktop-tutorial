import { DEFAULT_SOLUTION } from "../solution/loader";
import { isDue } from "./srs";
import type { SrsItem } from "./srs";

/** one pre-flop decision to ask again: the node of a solution and the hand class */
export interface ReviewItem {
  nodeId: number;
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

const depthOfSolution = (id: string) => Number(/(\d+)bb$/.exec(id)?.[1] ?? 0);

/** what is due now: per depth, the longest overdue and the most often missed first, at most REVIEW_ROUND to a round */
export function dueReview(all: SrsItem[], now: number, round = REVIEW_ROUND): ReviewQueue {
  const bySolution = new Map<string, SrsItem[]>();
  for (const it of all) {
    if (!isDue(it, now)) continue;
    const k = parseSrsKey(it.key);
    if (!k || k.hand < 0 || k.hand >= 169) continue;
    const list = bySolution.get(k.solution);
    if (list) list.push(it);
    else bySolution.set(k.solution, [it]);
  }
  const groups: ReviewGroup[] = [...bySolution].map(([solution, list]) => {
    const sorted = [...list].sort((a, b) => a.due - b.due || b.lapses - a.lapses);
    const items = sorted.slice(0, round).map((it) => {
      const k = parseSrsKey(it.key)!;
      return { nodeId: k.nodeId, hand: k.hand };
    });
    return { solution, due: list.length, items };
  });
  groups.sort((a, b) => b.due - a.due || depthOfSolution(a.solution) - depthOfSolution(b.solution));
  return { total: groups.reduce((s, g) => s + g.due, 0), groups };
}

/** the id of the question list a review round is stored under (`practiceSet:review`, read by the Practice screen) */
export const REVIEW_SET_ID = "review";
