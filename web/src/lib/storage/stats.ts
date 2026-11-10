import { isGood } from "../practice/grading";
import type { SpotType } from "../solution/types";
import type { Attempt } from "./types";

export interface Summary {
  n: number;
  accuracy: number;
  avgLoss: number;
  totalLoss: number;
  avgScore: number;
}

export function summarize(list: Attempt[]): Summary {
  const n = list.length;
  if (!n) return { n: 0, accuracy: 0, avgLoss: 0, totalLoss: 0, avgScore: 0 };
  let good = 0;
  let loss = 0;
  let score = 0;
  for (const a of list) {
    if (isGood(a.grade)) good++;
    loss += a.evLoss;
    score += a.score;
  }
  return { n, accuracy: good / n, avgLoss: loss / n, totalLoss: loss, avgScore: score / n };
}

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export interface DayPoint {
  date: string;
  n: number;
  avgScore: number;
  accuracy: number;
  avgLoss: number;
}

/** one point per calendar day for the last `days` days (days without data have n = 0) */
export function dailySeries(list: Attempt[], days: number, now: number): DayPoint[] {
  const byDay = new Map<string, Attempt[]>();
  for (const a of list) {
    const k = dayKey(a.ts);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(a);
  }
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const k = dayKey(d.getTime());
    const s = summarize(byDay.get(k) ?? []);
    out.push({ date: k, n: s.n, avgScore: s.avgScore, accuracy: s.accuracy, avgLoss: s.avgLoss });
  }
  return out;
}

/** consecutive days (ending today, or yesterday if nothing yet today) with at least one attempt */
export function studyStreak(list: Attempt[], now: number): number {
  const days = new Set(list.map((a) => dayKey(a.ts)));
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d.getTime()))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const todayCount = (list: Attempt[], now: number) => list.filter((a) => dayKey(a.ts) === dayKey(now)).length;

export interface HeatCell {
  seat: number;
  spot: SpotType;
  n: number;
  avgLoss: number;
  accuracy: number;
  totalLoss: number;
}

export function heatmap(list: Attempt[]): HeatCell[] {
  const m = new Map<string, Attempt[]>();
  for (const a of list) {
    const k = `${a.seat}:${a.spot}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push(a);
  }
  return [...m.entries()].map(([k, v]) => {
    const [seat, spot] = k.split(":");
    const s = summarize(v);
    return { seat: Number(seat), spot: spot as SpotType, n: s.n, avgLoss: s.avgLoss, accuracy: s.accuracy, totalLoss: s.totalLoss };
  });
}

/** weakest spots: largest accumulated EV loss, requiring a minimum sample */
export function weakSpots(list: Attempt[], minN = 3, top = 5): HeatCell[] {
  return heatmap(list)
    .filter((c) => c.n >= minN)
    .sort((a, b) => b.totalLoss - a.totalLoss)
    .slice(0, top);
}
