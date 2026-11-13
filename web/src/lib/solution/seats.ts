/**
 * Seats of a preflop solution, from its number of players (REFACTOR_PLAN step 2-5, ARCHITECTURE problem F).
 *
 * The rule, for any table size n = manifest.players.length:
 *   - seats are numbered in preflop acting order: seat 0 acts first, seat n-1 last;
 *   - the last two seats are the blinds: SB = n-2, BB = n-1;
 *   - the button sits just before the small blind (n-3); heads-up (n = 2) the small blind is the button (seat 0);
 *   - after the flop the small blind acts first and the button last; heads-up the big blind acts first.
 *
 * Seat names are counted from the back: BB, SB, BTN, CO, HJ, LJ; a table of six or more starts with UTG, and the seats
 * between UTG and the named ones are UTG+1, UTG+2, ... So 6 seats are UTG HJ CO BTN SB BB (the shipped solutions),
 * 2 are SB BB, 9 are UTG UTG+1 UTG+2 LJ HJ CO BTN SB BB. The screens show the manifest's own names (manifest.players);
 * these are for places that only know the number of seats.
 *
 * Seat numbers are what records store (Attempt.seat), so for 6 seats they keep their meaning: 0 = UTG ... 5 = BB.
 */

/** names of the seats from the back of the table, big blind first */
const FROM_BACK = ["BB", "SB", "BTN", "CO", "HJ", "LJ"] as const;

/** names of the seats of an n-player table, in preflop acting order (see the rule above) */
export function seatNames(n: number): string[] {
  if (!Number.isInteger(n) || n < 2) throw new Error(`a table has at least two seats, not ${n}`);
  if (n <= 5) return FROM_BACK.slice(0, n).reverse();
  // six or more: UTG first, then UTG+1 ... and at most the six named back seats (a 6-seat table has no LJ)
  const back = Math.min(FROM_BACK.length, n - 1);
  const front = Array.from({ length: n - back }, (_, i) => (i === 0 ? "UTG" : `UTG+${i}`));
  return [...front, ...FROM_BACK.slice(0, back).reverse()];
}

/** the small blind's seat: the second to last */
export const sbSeat = (n: number): number => n - 2;
/** the big blind's seat: the last */
export const bbSeat = (n: number): number => n - 1;
/** the button's seat: just before the small blind; heads-up the small blind itself */
export const buttonSeat = (n: number): number => (n === 2 ? 0 : n - 3);
/** every seat number of an n-player table, in acting order */
export const allSeats = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** order of acting after the flop (0 acts first): SB, BB, then seat 0 ... the button; heads-up BB, then SB (the button) */
export function postflopRank(seat: number, n: number): number {
  if (n === 2) return 1 - seat;
  return (seat - sbSeat(n) + n) % n;
}

/** where one seat sits on the table oval, in % of the table's box */
export interface SeatSpot {
  /** the seat's centre */
  x: number;
  y: number;
  /** where its bet chips sit, between the seat and the pot */
  betX: number;
  betY: number;
}

/** centre and radii (in %) of the oval the seats sit on */
const OVAL = { cx: 50, cy: 44, rx: 41, ry: 33 } as const;
/** centre the bets move towards, and how far from the seat towards it they go */
const BET = { cx: 50, cy: 42, pull: 0.55 } as const;
/** the hero's chips go beside the hole cards instead */
const HERO_BET = { x: 72, y: 62 } as const;

/**
 * Seat spots of an n-seat table as seen by the hero: index k = k seats clockwise from the hero, the hero (k = 0) at the
 * bottom centre and the others evenly spaced around the oval. Used by components/PokerTable.tsx.
 */
export function tableLayout(n: number): SeatSpot[] {
  const step = 360 / n;
  return Array.from({ length: n }, (_, k) => {
    const a = (90 + k * step) * (Math.PI / 180);
    const x = OVAL.cx + OVAL.rx * Math.cos(a);
    const y = OVAL.cy + OVAL.ry * Math.sin(a);
    const bet = k === 0 ? { betX: HERO_BET.x, betY: HERO_BET.y } : { betX: BET.cx + (x - BET.cx) * BET.pull, betY: BET.cy + (y - BET.cy) * BET.pull };
    return { x, y, ...bet };
  });
}

/** spot of seat `seat` on an n-seat table whose hero sits at seat `hero` */
export const seatSpot = (layout: readonly SeatSpot[], seat: number, hero: number): SeatSpot => layout[(seat - hero + layout.length) % layout.length];
