import { describe, expect, it } from "vitest";
import { categoryOf, eval7, HAND_CATEGORIES } from "../poker/eval7";
import { parseBoard } from "../postflop/combos";
import { mulberry32 } from "../util/rng";

const score = (s: string) => eval7(parseBoard(s));

/** an independent reference: best of the 5-card subsets, each ranked by (category, tie-breakers) from rank multiplicities */
function ref5(cards: number[]): number[] {
  const ranks = cards.map((c) => c >> 2).sort((a, b) => b - a);
  const flush = new Set(cards.map((c) => c & 3)).size === 1;
  const groups = new Map<number, number>();
  for (const r of ranks) groups.set(r, (groups.get(r) ?? 0) + 1);
  const byCount = [...groups].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = byCount.map((g) => g[1]).join("");
  const order = byCount.map((g) => g[0]);
  const uniq = [...new Set(ranks)];
  let straight = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straight = uniq[0];
    else if (uniq.join() === "12,3,2,1,0") straight = 3; // the wheel
  }
  if (straight >= 0 && flush) return [8, straight];
  if (shape === "41") return [7, ...order];
  if (shape === "32") return [6, ...order];
  if (flush) return [5, ...ranks];
  if (straight >= 0) return [4, straight];
  if (shape === "311") return [3, ...order];
  if (shape === "221") return [2, ...order];
  if (shape === "2111") return [1, ...order];
  return [0, ...ranks];
}
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -1) !== (b[i] ?? -1)) return (a[i] ?? -1) - (b[i] ?? -1);
  return 0;
};
function ref7(cards: number[]): number[] {
  let best: number[] | null = null;
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      const five = cards.filter((_, k) => k !== i && k !== j);
      const r = ref5(five);
      if (!best || cmp(r, best) > 0) best = r;
    }
  return best!;
}

describe("7-card evaluator", () => {
  it("ranks the well-known hands in order", () => {
    const order = [
      "Ah Kh Qh Jh Th 2c 3d", // royal flush
      "9s 8s 7s 6s 5s Ad Ac", // straight flush
      "Kc Kd Kh Ks 2c 2d 9h", // four of a kind
      "Qc Qd Qh 4s 4c 9d 2h", // full house
      "Ah 9h 7h 4h 2h Kd Kc", // flush
      "Tc 9d 8h 7s 6c 2d 2h", // straight
      "8c 8d 8h Ks 5c 3d 2h", // three of a kind
      "Jc Jd 6h 6s Ac 3d 2h", // two pair
      "Ac Ad 9h 6s 4c 3d 2h", // pair
      "Ac Jd 9h 6s 4c 3d 2h", // high card
    ];
    const s = order.map(score);
    for (let i = 1; i < s.length; i++) expect(s[i - 1], order[i - 1]).toBeGreaterThan(s[i]);
    expect(s.map(categoryOf)).toEqual(["straightFlush", "straightFlush", "quads", "fullHouse", "flush", "straight", "trips", "twoPair", "pair", "high"]);
  });

  it("handles the corner cases", () => {
    // the wheel is the lowest straight, the broadway the highest
    expect(score("Ac 2d 3h 4s 5c 9d Kh")).toBeLessThan(score("2c 3d 4h 5s 6c 9d Kh"));
    expect(categoryOf(score("Ac 2d 3h 4s 5c 9d Kh"))).toBe("straight");
    expect(score("Tc Jd Qh Ks Ac 2d 2h")).toBeGreaterThan(score("9c Td Jh Qs Kc 2d 2h"));
    // an ace-high flush draw is not a straight flush; the wheel can be a straight flush
    expect(categoryOf(score("As 2s 3s 4s 5s Kd Kc"))).toBe("straightFlush");
    // two sets of trips make a full house; three pairs play the best two and the best kicker
    expect(categoryOf(score("Kc Kd Kh 5s 5c 5d 2h"))).toBe("fullHouse");
    expect(score("Kc Kd Kh 5s 5c 5d 2h")).toBeGreaterThan(score("Kc Kd Kh 4s 4c 2d 2h"));
    expect(score("Ac Ad Kh Ks 5c 5d 2h")).toBe(score("Ac Ad Kh Ks 5c 3d 2h")); // the third pair's rank is the kicker (a 5 either way)
    expect(score("Ac Ad Kh Ks Qc 5d 2h")).toBeGreaterThan(score("Ac Ad Kh Ks 5c 3d 2h")); // a queen beats it
    // the kicker decides, the suits do not
    expect(score("Ac Kd 9h 6s 4c 3d 2h")).toBeGreaterThan(score("Ac Qd 9h 6s 4c 3d 2h"));
    expect(score("Ac Kd 9h 6s 4c 3d 2h")).toBe(score("Ah Ks 9d 6c 4h 3s 2c"));
    // a flush beats a straight; a full house beats a flush; the board plays
    expect(score("Ah 9h 7h 4h 2h Tc 9d")).toBeGreaterThan(score("5c 6d 7h 8s 9c 2d 2h"));
    expect(score("Ah Kh Qh Jh Th 2c 2d")).toBe(score("Ah Kh Qh Jh Th 3c 4d"));
  });

  it("counts every one of the 2,598,960 five-card hands into the textbook categories", () => {
    const counts = new Array(9).fill(0);
    const hand = [0, 0, 0, 0, 0];
    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++) {
              hand[0] = a;
              hand[1] = b;
              hand[2] = c;
              hand[3] = d;
              hand[4] = e;
              counts[eval7(hand) >> 20]++;
            }
    // high card, pair, two pair, three of a kind, straight, flush, full house, four of a kind, straight flush (with royal)
    expect(counts).toEqual([1_302_540, 1_098_240, 123_552, 54_912, 10_200, 5_108, 3_744, 624, 40]);
    expect(HAND_CATEGORIES).toHaveLength(9);
  }, 60_000);

  it("agrees with the reference on which of two random seven-card hands wins", () => {
    const rnd = mulberry32(7);
    const deal = () => {
      const deck = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 51; i > 44; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      return deck.slice(45);
    };
    for (let i = 0; i < 20_000; i++) {
      const a = deal();
      const b = deal();
      const mine = Math.sign(eval7(a) - eval7(b));
      const theirs = Math.sign(cmp(ref7(a), ref7(b)));
      if (mine !== theirs) throw new Error(`disagree on ${a} vs ${b}: ${mine} vs ${theirs}`);
    }
  }, 60_000);
});
