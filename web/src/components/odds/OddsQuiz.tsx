"use client";
import { useState } from "react";
import { useSettings } from "@/lib/settings";
import { cryptoRandom } from "@/lib/util/rng";
import { isCorrectOddsQuizAnswer, makeOddsQuizQuestion } from "@/lib/poker/oddsQuiz";
import type { OddsQuizQuestion } from "@/lib/poker/oddsQuiz";
import type { Key } from "@/lib/i18n/ja";

interface Score {
  answered: number;
  correct: number;
  streak: number;
}

const emptyScore = (): Score => ({ answered: 0, correct: 0, streak: 0 });

export function OddsQuiz() {
  const { t } = useSettings();
  const [question, setQuestion] = useState<OddsQuizQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState<Score>(emptyScore);

  const start = () => {
    setQuestion(makeOddsQuizQuestion(cryptoRandom));
    setSelected(null);
    setScore(emptyScore());
  };

  const answer = (choice: number) => {
    if (!question || selected !== null) return;
    setSelected(choice);
    setScore((current) => ({
      answered: current.answered + 1,
      correct: current.correct + (isCorrectOddsQuizAnswer(question, choice) ? 1 : 0),
      streak: isCorrectOddsQuizAnswer(question, choice) ? current.streak + 1 : 0,
    }));
  };

  const next = () => {
    setQuestion(makeOddsQuizQuestion(cryptoRandom));
    setSelected(null);
  };

  const prompt = question?.kind === "callEquity"
    ? t("odds.quiz.callQuestion", { pot: question.pot, bet: question.bet })
    : question?.kind === "outs"
      ? t("odds.quiz.outsQuestion", { outs: question.outs, street: t(`odds.quiz.street.${question.street}` as Key) })
      : null;
  const correct = question !== null && selected !== null && isCorrectOddsQuizAnswer(question, selected);
  const explanation = question?.kind === "callEquity"
    ? t("odds.quiz.callExplanation", { answer: question.answer.toFixed(1) })
    : question?.kind === "outs"
      ? t("odds.quiz.outsExplanation", { answer: question.answer.toFixed(1), outs: question.outs, street: t(`odds.quiz.street.${question.street}` as Key) })
      : null;

  return (
    <section className="space-y-3 rounded-card border border-line bg-surface p-3" aria-label={t("odds.quiz.title")} data-testid="odds-quiz">
      <div>
        <h2 className="font-bold">{t("odds.quiz.title")}</h2>
        <p className="mt-1 text-xs text-muted">{t("odds.quiz.intro")}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums" data-testid="odds-quiz-score">
        {t("odds.quiz.score", { correct: score.correct, answered: score.answered, streak: score.streak })}
      </p>
      {question === null ? (
        <button type="button" data-testid="odds-quiz-start" onClick={start} className="min-h-tap-lg w-full rounded-control bg-accent font-bold text-accent-ink">
          {t("odds.quiz.start")}
        </button>
      ) : (
        <>
          <p className="rounded-control bg-surface-2 p-3 text-sm font-semibold" data-testid="odds-quiz-question">{prompt}</p>
          <div role="group" aria-label={t("odds.quiz.answers")} className="grid grid-cols-2 gap-2">
            {question.choices.map((choice) => {
              const isAnswer = choice === question.answer;
              const isSelected = selected === choice;
              const mark = selected === null ? "" : isAnswer ? " ✓" : isSelected ? " ✕" : "";
              const tone = selected === null
                ? "border-line bg-surface-2 text-ink"
                : isAnswer
                  ? "border-[color:var(--g-best)] bg-[color:var(--g-best)]/15 text-ink"
                  : isSelected
                    ? "border-[color:var(--g-blunder)] bg-[color:var(--g-blunder)]/15 text-ink"
                    : "border-line bg-surface text-muted";
              return (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={selected !== null}
                  data-testid="odds-quiz-choice"
                  onClick={() => answer(choice)}
                  className={`min-h-tap-lg rounded-control border px-3 text-lg font-extrabold tabular-nums disabled:cursor-default ${tone}`}
                >
                  {choice.toFixed(1)}%{mark}
                </button>
              );
            })}
          </div>
          {selected !== null && question && (
            <div className="space-y-2 rounded-control border border-line p-3">
              <p role="status" data-testid="odds-quiz-result" className="font-bold">
                {correct ? t("odds.quiz.correct", { answer: question.answer.toFixed(1) }) : t("odds.quiz.incorrect", { answer: question.answer.toFixed(1) })}
              </p>
              <p className="text-xs text-muted">{explanation}</p>
              <button type="button" data-testid="odds-quiz-next" onClick={next} className="min-h-tap-lg w-full rounded-control bg-accent font-bold text-accent-ink">
                {t("odds.quiz.next")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
