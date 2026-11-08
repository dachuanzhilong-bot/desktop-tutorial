/**
 * 13x13 hand-class grid helpers.
 * Class id = row * 13 + col; row/col 0 = A ... 12 = 2.
 * Diagonal = pairs, above the diagonal (row < col) = suited, below = offsuit.
 * Mirrors solver/src/cards.rs.
 */
export const RANK_CHARS = "AKQJT98765432";
export const NUM_CLASSES = 169;

/** card rank value (0 = deuce ... 12 = ace) for a grid index (0 = A) */
export const rankOfIndex = (i: number) => 12 - i;

export interface ClassInfo {
  id: number;
  row: number;
  col: number;
  /** highest / lowest rank as grid indices (0 = A) */
  hi: number;
  lo: number;
  suited: boolean;
  pair: boolean;
  name: string;
  combos: number;
}

const CACHE: ClassInfo[] = [];

export function classInfo(id: number): ClassInfo {
  const hit = CACHE[id];
  if (hit) return hit;
  const row = Math.floor(id / 13);
  const col = id % 13;
  const pair = row === col;
  const suited = row < col;
  const hi = Math.min(row, col);
  const lo = Math.max(row, col);
  const name = RANK_CHARS[hi] + RANK_CHARS[lo] + (pair ? "" : suited ? "s" : "o");
  const info: ClassInfo = { id, row, col, hi, lo, suited, pair, name, combos: pair ? 6 : suited ? 4 : 12 };
  CACHE[id] = info;
  return info;
}

export const ALL_CLASSES: ClassInfo[] = Array.from({ length: NUM_CLASSES }, (_, i) => classInfo(i));

export function classByName(name: string): number {
  const c = ALL_CLASSES.find((x) => x.name === name);
  if (!c) throw new Error(`unknown hand class ${name}`);
  return c.id;
}

export const SUITS = ["s", "h", "d", "c"] as const;
export type Suit = (typeof SUITS)[number];
export interface Card {
  /** 0 = deuce ... 12 = ace */
  rank: number;
  suit: Suit;
}
export const cardText = (c: Card) => RANK_CHARS[12 - c.rank] + c.suit;

/** all concrete two-card combos of a class (suit isomorphic) */
export function classCombos(id: number): [Card, Card][] {
  const { hi, lo, suited, pair } = classInfo(id);
  const r1 = rankOfIndex(hi);
  const r2 = rankOfIndex(lo);
  const out: [Card, Card][] = [];
  if (pair) {
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) out.push([{ rank: r1, suit: SUITS[a] }, { rank: r1, suit: SUITS[b] }]);
  } else if (suited) {
    for (let s = 0; s < 4; s++) out.push([{ rank: r1, suit: SUITS[s] }, { rank: r2, suit: SUITS[s] }]);
  } else {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) out.push([{ rank: r1, suit: SUITS[a] }, { rank: r2, suit: SUITS[b] }]);
  }
  return out;
}

/** deterministic-friendly random concrete combo of a class */
export function randomCombo(id: number, rnd: () => number): [Card, Card] {
  const combos = classCombos(id);
  const c = combos[Math.floor(rnd() * combos.length)];
  // random order of the two cards for display variety
  return rnd() < 0.5 ? c : [c[1], c[0]];
}

// --------------------------------------------------------------- filters

export type HandFilterId =
  | "all"
  | "pairs"
  | "suited"
  | "offsuit"
  | "broadway"
  | "suitedAces"
  | "suitedConnectors"
  | "suitedGappers"
  | "smallPairs"
  | "bigPairs";

export const HAND_FILTERS: HandFilterId[] = [
  "all",
  "pairs",
  "bigPairs",
  "smallPairs",
  "suited",
  "offsuit",
  "broadway",
  "suitedAces",
  "suitedConnectors",
  "suitedGappers",
];

export function matchesFilter(id: number, f: HandFilterId): boolean {
  const c = classInfo(id);
  switch (f) {
    case "all":
      return true;
    case "pairs":
      return c.pair;
    case "bigPairs":
      return c.pair && c.hi <= 4; // AA..TT
    case "smallPairs":
      return c.pair && c.hi > 4;
    case "suited":
      return c.suited;
    case "offsuit":
      return !c.suited && !c.pair;
    case "broadway":
      return c.hi <= 4 && c.lo <= 4 && !c.pair; // both T or higher
    case "suitedAces":
      return c.suited && c.hi === 0;
    case "suitedConnectors":
      return c.suited && c.lo - c.hi === 1 && c.hi >= 1;
    case "suitedGappers":
      return c.suited && c.lo - c.hi === 2;
  }
}

/** does the class hold a card of this rank (blocker filter); rank given as grid index (0 = A) */
export const holdsRank = (id: number, rankIdx: number) => {
  const c = classInfo(id);
  return c.hi === rankIdx || c.lo === rankIdx;
};

/** combo weighted count helper */
export const comboCount = (id: number) => classInfo(id).combos;
