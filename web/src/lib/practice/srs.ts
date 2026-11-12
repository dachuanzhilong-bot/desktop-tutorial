import type { Grade } from "./grading";
import { isGood } from "./grading";

/** Leitner boxes with fixed intervals (minutes). A miss sends the item back to box 0. */
export const BOX_INTERVAL_MIN = [0, 10, 60 * 24, 60 * 24 * 3, 60 * 24 * 7, 60 * 24 * 21];

export interface SrsItem {
  /**
   * Primary key. Items made since REFACTOR_PLAN step 1-3: `k:<solution>:<pos>:<hand>` (posSrsKey, no node id).
   * Older items: `<node>:<hand>` (100bb), `<solution>:<node>:<hand>` (other depths), `p:<scenario>/<flop index>:<node>:<combo>`
   * (post-flop); they keep their key and have no `pos`. Never parse a `k:` key: read `solution`, `pos` and `hand`.
   */
  key: string;
  /** node id when the item was last answered. With `pos` it is only informative: the id is looked up again from `pos`. */
  nodeId: number;
  hand: number;
  /** position key (docs/03 "局面キー"): pre-flop the action line, post-flop `<flop>@<line>`. Absent in older items. */
  pos?: string;
  /** what `pos` is a position of: `cash6max-<depth>bb` or `post:<scenario>` (no flop index). Set together with `pos`. */
  solution?: string;
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

/** primary key of an item made with a position key: no node id, no flop index */
export const posSrsKey = (solution: string, pos: string, hand: number) => `k:${solution}:${pos}:${hand}`;

/**
 * The item after one more answer. A new item made with `at` gets the `k:` key and carries `solution` / `pos` / `build`.
 * An existing item keeps its key; one that already has a `pos` gets the current node id and build, an older one
 * (no `pos`) is updated as it always was.
 */
export function updateSrs(prev: SrsItem | undefined, nodeId: number, hand: number, grade: Grade, now: number, keyOverride?: string, at?: SrsPosition): SrsItem {
  const where = at ? { solution: at.solution, pos: at.pos, ...(at.build ? { build: at.build } : {}) } : null;
  const key = keyOverride ?? (at ? posSrsKey(at.solution, at.pos, hand) : `${nodeId}:${hand}`);
  let base: SrsItem = prev ?? { key, nodeId, hand, ...where, box: 0, due: now, seen: 0, lapses: 0, lastGrade: grade, updated: now };
  if (prev && where && prev.pos !== undefined) base = { ...prev, nodeId, ...where };
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

/**
 * Key of a (decision, hand) in the spaced-repetition store. The 100bb solution keeps the original
 * `<node>:<hand>` keys (existing records stay valid); other depths are prefixed with their solution id,
 * because node ids of different solutions mean different decisions.
 */
export const srsKey = (solution: string | undefined, nodeId: number, hand: number) => (!solution || solution === "cash6max-100bb" ? `${nodeId}:${hand}` : `${solution}:${nodeId}:${hand}`);


/**
 * The spaced-repetition items of this device, looked up by (solution, position key, hand). Items made before
 * position keys existed have no `pos`: only those are found by their old key string.
 */
export class SrsIndex {
  private byPos = new Map<string, Map<string, Map<number, SrsItem>>>();
  private legacy = new Map<string, SrsItem>();

  constructor(items: Iterable<SrsItem> = []) {
    for (const it of items) this.put(it);
  }

  put(it: SrsItem): void {
    if (it.pos === undefined || it.solution === undefined) {
      this.legacy.set(it.key, it);
      return;
    }
    let positions = this.byPos.get(it.solution);
    if (!positions) this.byPos.set(it.solution, (positions = new Map()));
    let hands = positions.get(it.pos);
    if (!hands) positions.set(it.pos, (hands = new Map()));
    hands.set(it.hand, it);
  }

  /** the item of a hand at a position; `legacyKey` = the key an item of this decision had before position keys */
  find(solution: string, pos: string, hand: number, legacyKey?: string): SrsItem | undefined {
    return this.byPos.get(solution)?.get(pos)?.get(hand) ?? (legacyKey === undefined ? undefined : this.legacy.get(legacyKey));
  }
}
