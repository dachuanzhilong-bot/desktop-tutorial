/**
 * Grading is based on EV loss in big blinds:
 *   best        – the highest-EV action (or within 0.005 bb of it)
 *   correct     – within 0.05 bb, or an action the solution mixes in with >= 10 % frequency
 *   inaccurate  – up to 0.2 bb
 *   mistake     – up to 0.6 bb
 *   blunder     – more
 */
export type Grade = "best" | "correct" | "inaccurate" | "mistake" | "blunder";
export const GRADES: Grade[] = ["best", "correct", "inaccurate", "mistake", "blunder"];

export const THRESHOLDS = { best: 0.005, correct: 0.05, inaccurate: 0.2, mistake: 0.6 } as const;
export const MIXED_FREQ = 0.1;
/** EV loss at which the per-hand score reaches zero */
export const SCORE_ZERO_LOSS = 0.8;

export interface ActionStat {
  freq: number;
  ev: number;
}

export interface GradeResult {
  grade: Grade;
  /** EV(best) - EV(chosen), >= 0, in bb */
  evLoss: number;
  /** 0..100 */
  score: number;
  bestIndex: number;
}

export function gradeAnswer(stats: ActionStat[], chosen: number): GradeResult {
  let bestIndex = 0;
  stats.forEach((s, i) => {
    if (s.ev > stats[bestIndex].ev + 1e-9) bestIndex = i;
  });
  const evLoss = Math.max(0, stats[bestIndex].ev - stats[chosen].ev);
  let grade: Grade;
  if (chosen === bestIndex || evLoss <= THRESHOLDS.best) grade = "best";
  else if (evLoss <= THRESHOLDS.correct || stats[chosen].freq >= MIXED_FREQ) grade = "correct";
  else if (evLoss <= THRESHOLDS.inaccurate) grade = "inaccurate";
  else if (evLoss <= THRESHOLDS.mistake) grade = "mistake";
  else grade = "blunder";
  return { grade, evLoss, score: scoreFromLoss(evLoss, grade), bestIndex };
}

export function scoreFromLoss(evLoss: number, grade: Grade): number {
  if (grade === "best") return 100;
  if (grade === "correct") return Math.max(90, Math.round(100 * (1 - evLoss / SCORE_ZERO_LOSS)));
  return Math.max(0, Math.round(100 * (1 - evLoss / SCORE_ZERO_LOSS)));
}

export const isGood = (g: Grade) => g === "best" || g === "correct";

/**
 * RNG mode: a number in [0,1) picks the action the strategy prescribes.
 * Actions are laid out in the order given (the app uses raise, call, fold).
 */
export function actionForRoll(freqs: number[], order: number[], roll: number): number {
  let acc = 0;
  for (const i of order) {
    acc += freqs[i];
    if (roll < acc) return i;
  }
  return order[order.length - 1];
}
