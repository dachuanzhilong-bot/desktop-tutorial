import type { Grade } from "./grading";
import { isGood } from "./grading";

/** Leitner boxes with fixed intervals (minutes). A miss sends the item back to box 0. */
export const BOX_INTERVAL_MIN = [0, 10, 60 * 24, 60 * 24 * 3, 60 * 24 * 7, 60 * 24 * 21];

export interface SrsItem {
  /** `${nodeId}:${handClass}` */
  key: string;
  nodeId: number;
  hand: number;
  box: number;
  due: number; // epoch ms
  seen: number;
  lapses: number;
  lastGrade: Grade;
  updated: number;
}

export function updateSrs(prev: SrsItem | undefined, nodeId: number, hand: number, grade: Grade, now: number, keyOverride?: string): SrsItem {
  const key = keyOverride ?? `${nodeId}:${hand}`;
  const base: SrsItem = prev ?? { key, nodeId, hand, box: 0, due: now, seen: 0, lapses: 0, lastGrade: grade, updated: now };
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
