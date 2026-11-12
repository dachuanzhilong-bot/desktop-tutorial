import { describe, expect, it } from "vitest";
import { PF_INDEX } from "../postflop/loader";
import { parseBoard } from "../postflop/combos";
import { textureOf } from "../postflop/texture";
import { answerFor, isCorrectTexture, makeTextureQuestion, spanOf, TEXTURE_CHOICES, TEXTURE_KINDS } from "../postflop/textureQuiz";
import { mulberry32 } from "../util/rng";

const FLOPS = PF_INDEX.flops;

describe("flop-reading quiz", () => {
  it("answers come from the same classification as the report, whatever the suits are", () => {
    const rnd = mulberry32(3);
    for (let i = 0; i < 400; i++) {
      for (const kind of TEXTURE_KINDS) {
        const q = makeTextureQuestion(FLOPS, rnd, kind);
        expect(q.board).toHaveLength(3);
        expect(new Set(q.board).size).toBe(3); // three different cards
        // the permuted board keeps the ranks of the solved flop, and its texture is the solved flop's
        const original = parseBoard(FLOPS[q.flopIdx]);
        expect(q.board.map((c) => c >> 2).sort()).toEqual(original.map((c) => c >> 2).sort());
        expect(q.texture).toEqual(textureOf(original));
        expect(q.answer).toBe(answerFor(kind, textureOf(original)));
        expect(TEXTURE_CHOICES[kind], `${kind}: ${q.answer}`).toContain(q.answer);
        expect(q.choices).toBe(TEXTURE_CHOICES[kind]);
        expect(q.span).toBe(spanOf(original));
      }
    }
  });

  it("shows every kind, every flop, and all the suit patterns over many questions", () => {
    const rnd = mulberry32(9);
    const kinds = new Set<string>();
    const flops = new Set<number>();
    const answers: Record<string, Set<string>> = { suit: new Set(), connect: new Set(), paired: new Set(), high: new Set() };
    for (let i = 0; i < 3000; i++) {
      const q = makeTextureQuestion(FLOPS, rnd);
      kinds.add(q.kind);
      flops.add(q.flopIdx);
      answers[q.kind].add(q.answer);
    }
    expect([...kinds].sort()).toEqual([...TEXTURE_KINDS].sort());
    expect(flops.size).toBe(FLOPS.length);
    // every answer the buttons offer is the right one for some question
    for (const k of TEXTURE_KINDS) expect([...answers[k]].sort(), k).toEqual([...TEXTURE_CHOICES[k]].filter((c) => answers[k].has(c)).sort());
    expect(answers.suit.size).toBe(3);
    expect(answers.connect.size).toBe(3);
    expect(answers.paired.size).toBe(2);
  });

  it("the suit relabelling really changes the look: the same flop is dealt with other suits", () => {
    const rnd = mulberry32(5);
    const looks = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const q = makeTextureQuestion(FLOPS, () => (i % 2 ? 0 : rnd()), "suit");
      if (q.flopIdx === 0) looks.add(q.board.join(","));
    }
    expect(looks.size).toBeGreaterThan(3);
  });

  it("checks an answer, and measures the span the connectedness rule looks at", () => {
    const q = makeTextureQuestion(FLOPS, mulberry32(1), "suit");
    expect(isCorrectTexture(q, q.answer)).toBe(true);
    expect(isCorrectTexture(q, "not an answer")).toBe(false);
    expect(spanOf(parseBoard("9h 8h 7d"))).toBe(2);
    expect(spanOf(parseBoard("As 7d 2c"))).toBe(12);
  });
});
