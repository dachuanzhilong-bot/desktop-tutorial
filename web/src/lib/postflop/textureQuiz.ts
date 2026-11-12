import { parseBoard } from "./combos";
import { textureOf } from "./texture";
import type { Texture } from "./texture";

/**
 * A flop-reading question on one of the solved flops: the suits are permuted at random (a texture does not depend on the
 * suits), so the same flop looks different each time, and the answer comes from the same classification the aggregate
 * report uses (lib/postflop/texture.ts).
 */
export type TextureKind = "suit" | "connect" | "paired" | "high";
export const TEXTURE_KINDS: TextureKind[] = ["suit", "connect", "paired", "high"];

export const TEXTURE_CHOICES: Record<TextureKind, string[]> = {
  suit: ["rainbow", "twotone", "monotone"],
  connect: ["dry", "semi", "wet"],
  paired: ["no", "yes"],
  high: ["A", "K", "Q", "J", "T", "low"],
};

export interface TextureQuestion {
  kind: TextureKind;
  /** the flop as cards (codes 0..51), suits permuted */
  board: number[];
  /** index of the flop in the solved flops (the Study opens it) */
  flopIdx: number;
  answer: string;
  choices: string[];
  /** numbers behind the answer, for the explanation */
  span: number;
  texture: Texture;
}

/** one of the 24 ways to relabel the four suits */
function suitPermutation(rnd: () => number): number[] {
  const p = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.min(i, Math.floor(rnd() * (i + 1)));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

export function answerFor(kind: TextureKind, t: Texture): string {
  if (kind === "suit") return t.suit;
  if (kind === "connect") return t.connect;
  if (kind === "paired") return t.paired ? "yes" : "no";
  return t.high;
}

/** the gap between the highest and the lowest card of the flop (the "window" the straight classification looks at) */
export const spanOf = (board: number[]): number => {
  const ranks = board.map((c) => c >> 2);
  return Math.max(...ranks) - Math.min(...ranks);
};

/** `flops` are the solved flops as text ("As 7d 2c"); `kind` can be fixed by a test */
export function makeTextureQuestion(flops: string[], rnd: () => number, kind?: TextureKind): TextureQuestion {
  const flopIdx = Math.min(flops.length - 1, Math.floor(rnd() * flops.length));
  const perm = suitPermutation(rnd);
  const board = parseBoard(flops[flopIdx]).map((c) => (c & ~3) | perm[c & 3]);
  const k = kind ?? TEXTURE_KINDS[Math.min(TEXTURE_KINDS.length - 1, Math.floor(rnd() * TEXTURE_KINDS.length))];
  const texture = textureOf(board);
  return { kind: k, board, flopIdx, answer: answerFor(k, texture), choices: TEXTURE_CHOICES[k], span: spanOf(board), texture };
}

export const isCorrectTexture = (q: TextureQuestion, choice: string) => choice === q.answer;
