import { isGood } from "./grading";
import type { Grade } from "./grading";

export interface Result {
  grade: Grade;
  score: number;
  evLoss: number;
}

export interface SessionStats {
  n: number;
  totalScore: number;
  avgScore: number;
  accuracy: number;
  avgLoss: number;
  streak: number;
  bestStreak: number;
  byGrade: Record<Grade, number>;
}

export function sessionStats(results: Result[]): SessionStats {
  const byGrade: Record<Grade, number> = { best: 0, correct: 0, inaccurate: 0, mistake: 0, blunder: 0 };
  let streak = 0;
  let bestStreak = 0;
  let run = 0;
  let total = 0;
  let loss = 0;
  let good = 0;
  for (const r of results) {
    byGrade[r.grade]++;
    total += r.score;
    loss += r.evLoss;
    if (isGood(r.grade)) {
      good++;
      run++;
      bestStreak = Math.max(bestStreak, run);
    } else run = 0;
  }
  streak = run;
  const n = results.length;
  return { n, totalScore: total, avgScore: n ? total / n : 0, accuracy: n ? good / n : 0, avgLoss: n ? loss / n : 0, streak, bestStreak, byGrade };
}
