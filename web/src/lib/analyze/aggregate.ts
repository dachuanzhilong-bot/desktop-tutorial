import type { Grade } from "../practice/grading";
import type { SpotType } from "../solution/types";
import type { DecisionInfo } from "./match";
import type { StoredHand } from "../storage/types";

export interface Summary {
  hands: number;
  /** hands whose preflop could be graded */
  graded: number;
  decisions: number;
  totalLoss: number;
  /** EV loss per 100 imported hands (bb) */
  lossPer100: number;
  byGrade: Record<Grade, number>;
  /** hero's actual net result in bb over all hands, per 100 hands */
  netPer100: number;
  skipped: number;
}

export function summarize(list: StoredHand[]): Summary {
  const byGrade: Record<Grade, number> = { best: 0, correct: 0, inaccurate: 0, mistake: 0, blunder: 0 };
  let decisions = 0;
  let totalLoss = 0;
  let graded = 0;
  let net = 0;
  let skipped = 0;
  for (const h of list) {
    net += h.hand.heroNet;
    if (h.analysis.status === "skipped") skipped++;
    if (h.analysis.decisions.length) graded++;
    for (const d of h.analysis.decisions) {
      decisions++;
      totalLoss += d.evLoss;
      byGrade[d.grade]++;
    }
  }
  const n = list.length || 1;
  return { hands: list.length, graded, decisions, totalLoss, lossPer100: (100 * totalLoss) / n, byGrade, netPer100: (100 * net) / n, skipped };
}

export interface WeakSpot {
  seat: number;
  spot: SpotType;
  n: number;
  totalLoss: number;
  avgLoss: number;
  mistakes: number;
}

/** (position, spot type) pairs ordered by the EV they cost */
export function weakSpots(list: StoredHand[], limit = 6): WeakSpot[] {
  const map = new Map<string, WeakSpot>();
  for (const h of list)
    for (const d of h.analysis.decisions) {
      const k = `${d.seat}:${d.spot}`;
      const w = map.get(k) ?? { seat: d.seat, spot: d.spot, n: 0, totalLoss: 0, avgLoss: 0, mistakes: 0 };
      w.n++;
      w.totalLoss += d.evLoss;
      if (d.grade === "mistake" || d.grade === "blunder") w.mistakes++;
      map.set(k, w);
    }
  return [...map.values()]
    .map((w) => ({ ...w, avgLoss: w.totalLoss / w.n }))
    .filter((w) => w.totalLoss > 0.05)
    .sort((a, b) => b.totalLoss - a.totalLoss)
    .slice(0, limit);
}

/** hands the player got wrong, worst first, as practice questions (each (node, hand) once) */
export function practiceItems(list: StoredHand[], limit = 30, seat?: number, spot?: SpotType): { nodeId: number; hand: number }[] {
  const all: DecisionInfo[] = [];
  for (const h of list)
    for (const d of h.analysis.decisions) {
      if (d.grade === "best" || d.grade === "correct") continue;
      if (seat !== undefined && d.seat !== seat) continue;
      if (spot !== undefined && d.spot !== spot) continue;
      all.push(d);
    }
  all.sort((a, b) => b.evLoss - a.evLoss);
  const seen = new Set<string>();
  const out: { nodeId: number; hand: number }[] = [];
  for (const d of all) {
    const k = `${d.nodeId}:${d.handClass}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ nodeId: d.nodeId, hand: d.handClass });
    if (out.length >= limit) break;
  }
  return out;
}

export interface HandFilter {
  seat: number | null;
  /** only hands with at least one decision that is not best/correct */
  mistakesOnly: boolean;
  spot: SpotType | null;
  sort: "loss" | "recent";
}

export function filterHands(list: StoredHand[], f: HandFilter): StoredHand[] {
  const out = list.filter((h) => {
    if (f.seat !== null && h.hand.heroSeat !== f.seat) return false;
    if (f.mistakesOnly && !h.analysis.decisions.some((d) => d.grade !== "best" && d.grade !== "correct")) return false;
    if (f.spot !== null && !h.analysis.decisions.some((d) => d.spot === f.spot)) return false;
    return true;
  });
  return out.sort((a, b) => (f.sort === "loss" ? b.analysis.evLoss - a.analysis.evLoss || b.ts - a.ts : b.ts - a.ts));
}
