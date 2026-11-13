import type { Grade } from "./grading";
import { isGood } from "./grading";

/** Leitner boxes with fixed intervals (minutes). A miss sends the item back to box 0. */
export const BOX_INTERVAL_MIN = [0, 10, 60 * 24, 60 * 24 * 3, 60 * 24 * 7, 60 * 24 * 21];

export interface SrsItem {
  /** Primary key: `k:<solution>:<pos>:<hand>` (posSrsKey; no node id). Never parse it: read `solution`, `pos` and `hand`. */
  key: string;
  /** node id when the item was last answered. Only informative: the id is looked up again from `pos`. */
  nodeId: number;
  hand: number;
  /** position key (docs/03 "局面キー"): pre-flop the action line, post-flop `<flop>@<line>` */
  pos: string;
  /** what `pos` is a position of: a pre-flop solution id (lib/solution/catalog.ts) or `post:<scenario>` (no flop index) */
  solution: string;
  /** build ID of the solution data the item was last answered against */
  build?: string;
  box: number;
  due: number; // epoch ms
  seen: number;
  lapses: number;
  lastGrade: Grade;
  updated: number;
}

/** where a spaced-repetition item belongs: a solution and a position key in it (lib/practice/position.ts) */
export interface SrsPosition {
  solution: string;
  pos: string;
  build?: string;
}

/** primary key of an item: no node id, no flop index */
export const posSrsKey = (solution: string, pos: string, hand: number) => `k:${solution}:${pos}:${hand}`;

/**
 * The item of (position `at`, hand) after one more answer. A new item gets the `k:` key; an existing one keeps its
 * key and position and gets the node id the position has now and the build it was answered against.
 */
export function updateSrs(prev: SrsItem | undefined, at: SrsPosition, nodeId: number, hand: number, grade: Grade, now: number): SrsItem {
  const where = { solution: at.solution, pos: at.pos, ...(at.build ? { build: at.build } : {}) };
  const base: SrsItem = prev ? { ...prev, nodeId, ...where } : { key: posSrsKey(at.solution, at.pos, hand), nodeId, hand, ...where, box: 0, due: now, seen: 0, lapses: 0, lastGrade: grade, updated: now };
  let box = base.box;
  let lapses = base.lapses;
  if (isGood(grade)) box = Math.min(BOX_INTERVAL_MIN.length - 1, box + 1);
  else {
    box = 0;
    lapses += 1;
  }
  return { ...base, box, lapses, seen: base.seen + 1, lastGrade: grade, due: now + BOX_INTERVAL_MIN[box] * 60_000, updated: now };
}

export const isDue = (it: SrsItem, now: number) => it.due <= now;

/** weight for priority sampling of a candidate (node, hand) given its SRS record and mixedness */
export function priorityWeight(opts: { item?: SrsItem; now: number; mixedness: number; mixedBoost: boolean }): number {
  let w = 1;
  if (opts.mixedBoost) w += 2.5 * opts.mixedness; // mixedness: 0 pure .. 1 maximally mixed
  const it = opts.item;
  if (it) {
    if (it.lastGrade === "mistake" || it.lastGrade === "blunder" || it.lastGrade === "inaccurate") w += 3;
    if (isDue(it, opts.now)) w += 2 + Math.min(3, it.lapses);
    else w *= 0.35; // recently mastered
  }
  return w;
}

/** 0 for a pure strategy .. 1 for a 50/50 mix (normalised entropy-ish measure) */
export function mixedness(freqs: ArrayLike<number>): number {
  let top = 0;
  for (let i = 0; i < freqs.length; i++) top = Math.max(top, freqs[i]);
  return Math.min(1, (1 - top) * 2);
}

/** the spaced-repetition items of this device, looked up by (solution, position key, hand) */
export class SrsIndex {
  private byPos = new Map<string, Map<string, Map<number, SrsItem>>>();

  constructor(items: Iterable<SrsItem> = []) {
    for (const it of items) this.put(it);
  }

  put(it: SrsItem): void {
    let positions = this.byPos.get(it.solution);
    if (!positions) this.byPos.set(it.solution, (positions = new Map()));
    let hands = positions.get(it.pos);
    if (!hands) positions.set(it.pos, (hands = new Map()));
    hands.set(it.hand, it);
  }

  /** the item of a hand at a position */
  find(solution: string, pos: string, hand: number): SrsItem | undefined {
    return this.byPos.get(solution)?.get(pos)?.get(hand);
  }
}
