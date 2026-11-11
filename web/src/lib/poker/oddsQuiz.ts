import { betNumbers, DRAW_PRESETS, outsEquity } from "./math";

export type OddsQuizQuestion =
  | { kind: "callEquity"; pot: number; bet: number; answer: number; choices: number[] }
  | { kind: "outs"; outs: number; street: "flop" | "turn"; answer: number; choices: number[] };

const POTS = [60, 90, 120, 150] as const;
const BET_FRACTIONS = [1 / 3, 0.5, 0.75, 1] as const;
const percent = (x: number) => Number((x * 100).toFixed(1));

function index(random: () => number, length: number) {
  return Math.max(0, Math.min(length - 1, Math.floor(random() * length)));
}

function choices(answer: number, random: () => number) {
  const out = [answer - 5, answer, answer + 5, answer + 10];
  for (let i = out.length - 1; i > 0; i--) {
    const j = index(random, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Create an exact-odds question. The caller supplies randomness so tests can reproduce every scenario. */
export function makeOddsQuizQuestion(random: () => number): OddsQuizQuestion {
  if (random() < 0.5) {
    const pot = POTS[index(random, POTS.length)];
    const bet = Math.round(pot * BET_FRACTIONS[index(random, BET_FRACTIONS.length)]);
    const answer = percent(betNumbers(pot, bet)!.needed);
    return { kind: "callEquity", pot, bet, answer, choices: choices(answer, random) };
  }

  const draw = DRAW_PRESETS[index(random, DRAW_PRESETS.length)];
  const street = random() < 0.5 ? "flop" : "turn";
  const answer = percent(outsEquity(draw.outs, street)!.river);
  return { kind: "outs", outs: draw.outs, street, answer, choices: choices(answer, random) };
}

export const isCorrectOddsQuizAnswer = (question: OddsQuizQuestion, answer: number) => answer === question.answer;
