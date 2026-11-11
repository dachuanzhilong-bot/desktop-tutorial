/**
 * The standard poker arithmetic. `pot` is the pot before the bet in question, `bet` the bet that is made or faced;
 * any unit (bb, chips) works as long as it is the same for both. Results are fractions (0.25 = 25%), not percent.
 * Every function returns null when its inputs make no sense (zero pot, negative bet ...).
 */
const ok = (...xs: number[]) => xs.every((x) => Number.isFinite(x));

export interface BetNumbers {
  /** the bet as a fraction of the pot */
  size: number;
  /** what a call costs, and what it can win (the pot with the bet in it) */
  toCall: number;
  toWin: number;
  /** equity a call needs to break even: bet / (pot + 2 bet) */
  needed: number;
  /** pot odds as "x : 1": (pot + bet) / bet */
  ratio: number;
  /** minimum defence frequency: pot / (pot + bet) */
  mdf: number;
  /** share of bluffs in a betting range that leaves the caller indifferent: bet / (pot + 2 bet) */
  bluffShare: number;
  /** how often a pure bluff must work to break even: bet / (pot + bet) */
  alpha: number;
}

export function betNumbers(pot: number, bet: number): BetNumbers | null {
  if (!ok(pot, bet) || pot <= 0 || bet <= 0) return null;
  return {
    size: bet / pot,
    toCall: bet,
    toWin: pot + bet,
    needed: bet / (pot + 2 * bet),
    ratio: (pot + bet) / bet,
    mdf: pot / (pot + bet),
    bluffShare: bet / (pot + 2 * bet),
    alpha: bet / (pot + bet),
  };
}

/** value of calling with `equity` (0..1): equity x (pot + bet) - (1 - equity) x bet; the pot is as before the bet */
export function callEv(pot: number, bet: number, equity: number): number | null {
  if (!ok(pot, bet, equity) || pot <= 0 || bet <= 0 || equity < 0 || equity > 1) return null;
  return equity * (pot + bet) - (1 - equity) * bet;
}

/** what a call still has to win on later streets to break even with `equity` (0 when it already does) */
export function impliedNeeded(pot: number, bet: number, equity: number): number | null {
  if (!ok(pot, bet, equity) || pot <= 0 || bet <= 0 || equity <= 0 || equity > 1) return null;
  return Math.max(0, ((1 - equity) * bet) / equity - (pot + bet));
}

const choose2 = (n: number) => (n * (n - 1)) / 2;

export interface OutsEquity {
  /** hitting on the next card */
  next: number;
  /** hitting by the river (from the flop: two cards to come; from the turn: the same as `next`) */
  river: number;
  /** the "rule of 2 and 4" estimate of `river` */
  rule: number;
}

/** chance to hit one of `outs` cards; `street` is the one being played (flop: 47 cards unseen, turn: 46) */
export function outsEquity(outs: number, street: "flop" | "turn"): OutsEquity | null {
  const unseen = street === "flop" ? 47 : 46;
  if (!Number.isInteger(outs) || outs < 0 || outs > unseen) return null;
  const next = outs / unseen;
  if (street === "turn") return { next, river: next, rule: Math.min(1, (outs * 2) / 100) };
  return { next, river: 1 - choose2(unseen - outs) / choose2(unseen), rule: Math.min(1, (outs * 4) / 100) };
}

/** stack-to-pot ratio */
export function spr(stack: number, pot: number): number | null {
  if (!ok(stack, pot) || stack < 0 || pot <= 0) return null;
  return stack / pot;
}

/** a rule-of-thumb reading of the SPR: committing with top pair is easy when it is low, it takes a strong hand when it is high */
export type SprBand = "low" | "mid" | "high";
export const sprBand = (v: number): SprBand => (v <= 3 ? "low" : v <= 10 ? "mid" : "high");

/** common draws and how many cards complete them (the outs that are not counted twice) */
export const DRAW_PRESETS = [
  { id: "gutshot", outs: 4 },
  { id: "overs", outs: 6 },
  { id: "pairToTrips", outs: 5 },
  { id: "oesd", outs: 8 },
  { id: "flush", outs: 9 },
  { id: "flushGutshot", outs: 12 },
  { id: "flushOesd", outs: 15 },
] as const;
