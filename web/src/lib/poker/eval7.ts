/**
 * Hand strength of 5 to 7 cards, as one integer: a bigger number is a better hand, equal numbers tie.
 *
 * Cards are codes 0..51 as in lib/postflop/combos.ts: `rank * 4 + suit`, rank 0 = deuce … 12 = ace, suit 0..3.
 * Score = category << 20 | five kicker ranks packed in nibbles (most important first):
 *   8 straight flush · 7 four of a kind · 6 full house · 5 flush · 4 straight · 3 three of a kind · 2 two pair · 1 pair · 0 high card
 */
export const HAND_CATEGORIES = ["high", "pair", "twoPair", "trips", "straight", "flush", "fullHouse", "quads", "straightFlush"] as const;
export type HandCategory = (typeof HAND_CATEGORIES)[number];

export const categoryOf = (score: number): HandCategory => HAND_CATEGORIES[score >> 20];

// scratch space: evaluating millions of hands must not allocate
const suitMask = new Int32Array(4);
const count = new Int32Array(13);

/** the highest rank set in a 13-bit mask (-1 when empty) */
const top = (mask: number) => 31 - Math.clz32(mask);

/** the n highest ranks of a mask, packed one per nibble from the most significant of the five */
function pack(mask: number, n: number): number {
  let out = 0;
  let m = mask;
  for (let i = 0; i < 5; i++) {
    if (i < n && m) {
      const r = top(m);
      out |= r << (16 - 4 * i);
      m &= ~(1 << r);
    }
  }
  return out;
}

/** top rank of the best straight in a rank mask, or -1 (the ace also counts below the deuce: A-2-3-4-5 is the five) */
function straightTop(mask: number): number {
  const m = (mask << 1) | (mask >> 12); // bit 0 = ace as the low card, bit k = rank k - 1
  const s = m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4);
  return s ? top(s) + 3 : -1;
}

/** 5, 6 or 7 cards */
export function eval7(cards: ArrayLike<number>): number {
  suitMask.fill(0);
  count.fill(0);
  let all = 0;
  const n = cards.length;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    suitMask[c & 3] |= 1 << r;
    count[r]++;
    all |= 1 << r;
  }

  // flush (a straight flush is a straight inside the flush suit)
  let flush = -1;
  for (let s = 0; s < 4; s++) {
    if (popcount(suitMask[s]) >= 5) flush = s;
  }
  if (flush >= 0) {
    const st = straightTop(suitMask[flush]);
    if (st >= 0) return (8 << 20) | (st << 16);
  }

  // multiples
  let quad = -1;
  let trips = 0; // mask of ranks held three times
  let pairs = 0; // mask of ranks held twice
  for (let r = 12; r >= 0; r--) {
    const k = count[r];
    if (k === 4) quad = r;
    else if (k === 3) trips |= 1 << r;
    else if (k === 2) pairs |= 1 << r;
  }
  if (quad >= 0) {
    const kick = all & ~(1 << quad);
    return (7 << 20) | (quad << 16) | (kick ? top(kick) << 12 : 0);
  }
  if (trips && (trips & (trips - 1) || pairs)) {
    // full house: the best trips, then the best pair (a second set of trips plays as a pair)
    const t = top(trips);
    const rest = (trips & ~(1 << t)) | pairs;
    return (6 << 20) | (t << 16) | (top(rest) << 12);
  }
  if (flush >= 0) return (5 << 20) | pack(suitMask[flush], 5);
  const st = straightTop(all);
  if (st >= 0) return (4 << 20) | (st << 16);
  if (trips) {
    const t = top(trips);
    return (3 << 20) | (t << 16) | (pack(all & ~(1 << t), 2) >> 4);
  }
  if (pairs) {
    const hi = top(pairs);
    const rest = pairs & ~(1 << hi);
    if (rest) {
      // two pair (with three pairs on 7 cards the third pair can still be the kicker)
      const lo = top(rest);
      const kick = all & ~(1 << hi) & ~(1 << lo);
      return (2 << 20) | (hi << 16) | (lo << 12) | (kick ? top(kick) << 8 : 0);
    }
    return (1 << 20) | (hi << 16) | (pack(all & ~(1 << hi), 3) >> 4);
  }
  return pack(all, 5);
}

function popcount(x: number): number {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}
