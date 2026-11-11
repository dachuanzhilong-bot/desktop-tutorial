import { describe, expect, it } from "vitest";
import { isCorrectOddsQuizAnswer, makeOddsQuizQuestion } from "../poker/oddsQuiz";

describe("odds quiz", () => {
  it("builds call-equity questions from the exact pot-odds formula", () => {
    const q = makeOddsQuizQuestion(() => 0.1);
    expect(q).toMatchObject({ kind: "callEquity", pot: 60, bet: 20, answer: 20 });
    expect(q.choices).toHaveLength(4);
    expect(new Set(q.choices).size).toBe(4);
    expect(q.choices).toContain(q.answer);
    expect(q.choices.filter((x) => isCorrectOddsQuizAnswer(q, x))).toEqual([q.answer]);
  });

  it("builds outs questions from exact runout probabilities, not the rule of 2 and 4", () => {
    const values = [0.9, 0.6, 0.1, 0.5, 0.5, 0.5]; // flush draw, flop
    let i = 0;
    const q = makeOddsQuizQuestion(() => values[i++ % values.length]);
    expect(q).toMatchObject({ kind: "outs", outs: 9, street: "flop", answer: 35 });
    expect(q.choices).toHaveLength(4);
    expect(new Set(q.choices).size).toBe(4);
    expect(q.choices).toContain(q.answer);
  });

  it("uses the turn deck size and always keeps four choices in the percentage range", () => {
    const q = makeOddsQuizQuestion(() => 0.9);
    expect(q).toMatchObject({ kind: "outs", outs: 15, street: "turn", answer: 32.6 });
    expect(q.choices.every((x) => x >= 0 && x <= 100)).toBe(true);
  });
});
