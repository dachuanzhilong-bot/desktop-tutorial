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

/**
 * Running sums of a group of attempts. They are added in record order everywhere (here and in the saved totals of
 * lib/storage/statsCache.ts), so the sums are the same floating-point numbers however they were made.
 */
export interface Acc {
  n: number;
  good: number;
  loss: number;
  score: number;
}

export const emptyAcc = (): Acc => ({ n: 0, good: 0, loss: 0, score: 0 });

export function accAdd(acc: Acc, a: Attempt): void {
  acc.n++;
  if (isGood(a.grade)) acc.good++;
  acc.loss += a.evLoss;
  acc.score += a.score;
}

export function summaryOf(acc: Acc): Summary {
  const { n } = acc;
  if (!n) return { n: 0, accuracy: 0, avgLoss: 0, totalLoss: 0, avgScore: 0 };
  return { n, accuracy: acc.good / n, avgLoss: acc.loss / n, totalLoss: acc.loss, avgScore: acc.score / n };
}

export function summarize(list: Attempt[]): Summary {
  const acc = emptyAcc();
  for (const a of list) accAdd(acc, a);
  return summaryOf(acc);
}

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** epoch ms of the local midnight that starts the day of `ts` */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DayPoint {
  date: string;
  n: number;
  avgScore: number;
  accuracy: number;
  avgLoss: number;
}

/** one point per calendar day for the last `days` days; `ofDay` gives the summary of a day key */
export function seriesOf(ofDay: (day: string) => Summary, days: number, now: number): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const k = dayKey(d.getTime());
    const s = ofDay(k);
    out.push({ date: k, n: s.n, avgScore: s.avgScore, accuracy: s.accuracy, avgLoss: s.avgLoss });
  }
  return out;
}

/** one point per calendar day for the last `days` days (days without data have n = 0) */
export function dailySeries(list: Attempt[], days: number, now: number): DayPoint[] {
  const byDay = new Map<string, Acc>();
  for (const a of list) {
    const k = dayKey(a.ts);
    let acc = byDay.get(k);
    if (!acc) byDay.set(k, (acc = emptyAcc()));
    accAdd(acc, a);
  }
  return seriesOf((k) => summaryOf(byDay.get(k) ?? emptyAcc()), days, now);
}

/** consecutive days (ending today, or yesterday if nothing yet today) among `days`, the day keys with an attempt */
export function streakOf(days: { has(day: string): boolean }, now: number): number {
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

/** consecutive days (ending today, or yesterday if nothing yet today) with at least one attempt */
export function studyStreak(list: Attempt[], now: number): number {
  return streakOf(new Set(list.map((a) => dayKey(a.ts))), now);
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

export function heatCell(seat: number, spot: SpotType, acc: Acc): HeatCell {
  const s = summaryOf(acc);
  return { seat, spot, n: s.n, avgLoss: s.avgLoss, accuracy: s.accuracy, totalLoss: s.totalLoss };
}

/** one cell per seat and spot, in the order of their first attempt */
export function heatmap(list: Attempt[]): HeatCell[] {
  const m = new Map<string, { seat: number; spot: SpotType; acc: Acc }>();
  for (const a of list) {
    const k = `${a.seat}:${a.spot}`;
    let c = m.get(k);
    if (!c) m.set(k, (c = { seat: a.seat, spot: a.spot, acc: emptyAcc() }));
    accAdd(c.acc, a);
  }
  return [...m.values()].map((c) => heatCell(c.seat, c.spot, c.acc));
}

/** the weakest heat-map cells: largest accumulated EV loss, requiring a minimum sample */
export function weakestCells(cells: HeatCell[], minN = 3, top = 5): HeatCell[] {
  return cells
    .filter((c) => c.n >= minN)
    .sort((a, b) => b.totalLoss - a.totalLoss)
    .slice(0, top);
}

/** weakest spots: largest accumulated EV loss, requiring a minimum sample */
export function weakSpots(list: Attempt[], minN = 3, top = 5): HeatCell[] {
  return weakestCells(heatmap(list), minN, top);
}
