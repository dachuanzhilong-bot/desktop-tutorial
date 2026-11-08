import { cardCode } from "./combos";

/** Hand-vs-board descriptors used by the Study filters (made hand + draws). */
export type MadeHand = "straightflush" | "quads" | "fullhouse" | "flush" | "straight" | "set" | "twopair" | "overpair" | "toppair" | "secondpair" | "lowpair" | "nopair";
export interface HandInfo {
  made: MadeHand;
  flushDraw: boolean;
  /** open-ended (or double gutter) straight draw */
  oesd: boolean;
  gutshot: boolean;
}

export type CategoryId = "all" | "strong" | "twopair" | "overpair" | "toppair" | "weakpair" | "flushdraw" | "straightdraw" | "combodraw" | "air";
export const CATEGORY_IDS: CategoryId[] = ["all", "strong", "twopair", "overpair", "toppair", "weakpair", "flushdraw", "straightdraw", "combodraw", "air"];

function straightHigh(mask: number): number {
  // mask: bit r set when rank r (0 = deuce .. 12 = ace) is present; returns the highest straight's top rank or -1
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0x1f << (hi - 4);
    if ((mask & need) === need) return hi;
  }
  if ((mask & 0x100f) === 0x100f) return 3; // wheel
  return -1;
}

export function classify(board: number[], c1: number, c2: number): HandInfo {
  const cards = [...board, c1, c2];
  const cnt = new Array(13).fill(0);
  const suitCnt = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    cnt[c >> 2]++;
    suitCnt[c & 3]++;
    suitMask[c & 3] |= 1 << (c >> 2);
    mask |= 1 << (c >> 2);
  }
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCnt[s] >= 5) flushSuit = s;
  const sh = straightHigh(mask);
  const quads = cnt.some((x) => x === 4);
  const trips = cnt.filter((x) => x === 3).length;
  const pairs = cnt.filter((x) => x === 2).length;
  const [r1, r2] = [c1 >> 2, c2 >> 2];
  const boardRanks = board.map((c) => c >> 2).sort((a, b) => b - a);
  const bCnt = new Array(13).fill(0);
  for (const r of boardRanks) bCnt[r]++;

  let made: MadeHand;
  const holePairRanks: number[] = [];
  for (let r = 0; r < 13; r++) if (cnt[r] === 2 && (r === r1 || r === r2)) holePairRanks.push(r);
  const boardHasPair = bCnt.some((x) => x === 2);
  if (flushSuit >= 0 && straightHigh(suitMask[flushSuit]) >= 0) made = "straightflush";
  else if (quads) made = "quads";
  else if (trips >= 1 && (pairs >= 1 || trips >= 2)) made = "fullhouse";
  else if (flushSuit >= 0) made = "flush";
  else if (sh >= 0) made = "straight";
  else if (trips >= 1) {
    // a set / trips only counts as a made monster when a hole card is involved
    const tripRank = cnt.findIndex((x) => x === 3);
    made = r1 === tripRank || r2 === tripRank ? "set" : "nopair";
  } else if (holePairRanks.length >= 2) made = "twopair";
  else if (holePairRanks.length === 1) {
    const pr = holePairRanks[0];
    if (boardHasPair) made = "twopair"; // the board pair plus a pair made with a hole card
    else if (r1 === r2) made = r1 > boardRanks[0] ? "overpair" : r1 > boardRanks[1] ? "secondpair" : "lowpair";
    else if (pr === boardRanks[0]) made = "toppair";
    else if (pr === boardRanks[1]) made = "secondpair";
    else made = "lowpair";
  } else made = "nopair";

  // draws (only before the river)
  let flushDraw = false;
  let oesd = false;
  let gutshot = false;
  if (board.length < 5) {
    for (let s = 0; s < 4; s++) if (suitCnt[s] === 4 && ((c1 & 3) === s || (c2 & 3) === s)) flushDraw = true;
    if (made === "nopair" || made === "lowpair" || made === "secondpair" || made === "toppair" || made === "overpair" || made === "twopair" || made === "set") {
      const outs = new Set<number>();
      for (let r = 0; r < 13; r++) {
        if (cnt[r] === 4) continue;
        const m2 = mask | (1 << r);
        const had = straightHigh(mask);
        const has = straightHigh(m2);
        // must be a new straight that needs a hole card
        if (has >= 0 && has !== had) {
          const needHole = [...Array(5).keys()].some((i) => {
            const rr = (has - i + 13) % 13;
            return rr === r1 || rr === r2;
          });
          if (needHole) outs.add(r);
        }
      }
      if (outs.size >= 2) oesd = true;
      else if (outs.size === 1) gutshot = true;
    }
  }
  return { made, flushDraw, oesd, gutshot };
}

export function matchesCategory(info: HandInfo, cat: CategoryId): boolean {
  const strongMade = ["straightflush", "quads", "fullhouse", "flush", "straight", "set"].includes(info.made);
  const sdraw = info.oesd || info.gutshot;
  switch (cat) {
    case "all":
      return true;
    case "strong":
      return strongMade;
    case "twopair":
      return info.made === "twopair";
    case "overpair":
      return info.made === "overpair";
    case "toppair":
      return info.made === "toppair";
    case "weakpair":
      return info.made === "secondpair" || info.made === "lowpair";
    case "flushdraw":
      return info.flushDraw;
    case "straightdraw":
      return sdraw;
    case "combodraw":
      return info.flushDraw && sdraw;
    case "air":
      return info.made === "nopair" && !info.flushDraw && !sdraw;
  }
}

export { cardCode };
