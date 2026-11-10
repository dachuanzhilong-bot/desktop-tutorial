import type { FlopStats } from "./loader";
import type { Texture } from "./texture";

export type GroupBy = "high" | "suit" | "connect" | "paired";
export type Metric = "oopCheck" | "oopBet" | "ipBet" | "ipBigBet" | "eqIp";
export const GROUPS: GroupBy[] = ["high", "suit", "connect", "paired"];
export const METRICS: Metric[] = ["oopCheck", "oopBet", "ipBet", "ipBigBet", "eqIp"];
export const ORDER: Record<GroupBy, string[]> = {
  high: ["A", "K", "Q", "J", "T", "low"],
  suit: ["rainbow", "twotone", "monotone"],
  connect: ["dry", "semi", "wet"],
  paired: ["no", "yes"],
};

export function keyOf(g: GroupBy, t: Texture): string {
  return g === "high" ? t.high : g === "suit" ? t.suit : g === "connect" ? t.connect : t.paired ? "yes" : "no";
}

/** one number (0..1) per flop for the chosen metric, or null when the solution lacks it */
export function metricOf(m: Metric, s: FlopStats | undefined, pot: number): number | null {
  if (!s) return null;
  const big = (acts: [number, number][] | undefined, mix: number[] | undefined) => {
    if (!acts || !mix) return null;
    let v = 0;
    acts.forEach(([kind, amount], i) => {
      if (kind >= 2 && amount / pot >= 0.5) v += mix[i];
    });
    return v;
  };
  switch (m) {
    case "oopCheck":
      return s.oop ? s.oop[0] : null;
    case "oopBet":
      return s.oop ? 1 - s.oop[0] : null;
    case "ipBet":
      return s.ipVsCheck ? 1 - s.ipVsCheck[0] : null;
    case "ipBigBet":
      return big(s.ipActs, s.ipVsCheck);
    case "eqIp":
      return s.eqIp;
  }
}

export interface GroupAvg {
  key: string;
  n: number;
  avg: number;
}

export function groupAverages(rows: { tex: Texture; v: number | null }[], g: GroupBy): GroupAvg[] {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    if (r.v === null) continue;
    const k = keyOf(g, r.tex);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r.v);
  }
  return ORDER[g].filter((k) => m.has(k)).map((k) => ({ key: k, n: m.get(k)!.length, avg: m.get(k)!.reduce((a, b) => a + b, 0) / m.get(k)!.length }));
}
