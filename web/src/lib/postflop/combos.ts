import { NUM_CLASSES } from "../poker/hands";
import type { Card, Suit } from "../poker/hands";

/** must match solver/src/postflop.rs: combos are enumerated (a < b) over card = rank * 4 + suit, suit 0..3 = c d h s */
export const NC = 1326;
const SUIT_OF: Suit[] = ["c", "d", "h", "s"];

export const cardCode = (c: Card) => c.rank * 4 + SUIT_OF.indexOf(c.suit);
export const cardOf = (code: number): Card => ({ rank: code >> 2, suit: SUIT_OF[code & 3] });
export const parseCard = (s: string): number => "23456789TJQKA".indexOf(s[0]) * 4 + "cdhs".indexOf(s[1]);
export const parseBoard = (s: string): number[] => s.trim().split(/\s+/).map(parseCard);

export interface Combo {
  c1: number;
  c2: number;
  /** 0..168 hand class on the 13x13 chart */
  cls: number;
}

export function classOfCards(a: number, b: number): number {
  const [ra, rb] = [a >> 2, b >> 2];
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  if (hi === lo) return (12 - hi) * 13 + (12 - hi);
  if ((a & 3) === (b & 3)) return (12 - hi) * 13 + (12 - lo);
  return (12 - lo) * 13 + (12 - hi);
}

export const COMBOS: Combo[] = (() => {
  const v: Combo[] = [];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) v.push({ c1: a, c2: b, cls: classOfCards(a, b) });
  return v;
})();

export const COMBOS_OF_CLASS: number[][] = (() => {
  const out: number[][] = Array.from({ length: NUM_CLASSES }, () => []);
  COMBOS.forEach((c, i) => out[c.cls].push(i));
  return out;
})();

export const comboCards = (h: number): [Card, Card] => [cardOf(COMBOS[h].c1), cardOf(COMBOS[h].c2)];
export const cardText = (code: number) => "23456789TJQKA"[code >> 2] + "cdhs"[code & 3];
