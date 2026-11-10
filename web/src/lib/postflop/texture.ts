import { cardText } from "./combos";

export interface Texture {
  high: "A" | "K" | "Q" | "J" | "T" | "low";
  paired: boolean;
  suit: "rainbow" | "twotone" | "monotone";
  connect: "dry" | "semi" | "wet";
  broadways: number;
}

export function textureOf(board: number[]): Texture {
  const ranks = board.map((c) => c >> 2).sort((a, b) => b - a);
  const hi = ranks[0];
  const high = hi === 12 ? "A" : hi === 11 ? "K" : hi === 10 ? "Q" : hi === 9 ? "J" : hi === 8 ? "T" : "low";
  const paired = new Set(ranks).size < ranks.length;
  const sc = new Set(board.map((c) => c & 3)).size;
  const suit = sc === 3 ? "rainbow" : sc === 2 ? "twotone" : "monotone";
  const uniq = [...new Set(ranks)];
  const span = uniq[0] - uniq[uniq.length - 1];
  const gaps = uniq.slice(1).map((r, i) => uniq[i] - r);
  const minGap = gaps.length ? Math.min(...gaps) : 12;
  // wet: the cards sit within one straight window, or two of them touch and the third is close
  const connect = uniq.length >= 2 && (span <= 4 || (minGap <= 1 && span <= 5)) ? "wet" : uniq.length >= 2 && (span <= 6 || minGap <= 1) ? "semi" : "dry";
  return { high, paired, suit, connect, broadways: ranks.filter((r) => r >= 8).length };
}

export const boardText = (board: number[]) => board.map(cardText).join(" ");
