"use client";
import { useState } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import { useSettings } from "@/lib/settings";
import { cryptoRandom } from "@/lib/util/rng";
import { cardOf } from "@/lib/postflop/combos";
import { PF_INDEX } from "@/lib/postflop/loader";
import { isCorrectTexture, makeTextureQuestion } from "@/lib/postflop/textureQuiz";
import type { TextureQuestion } from "@/lib/postflop/textureQuiz";
import type { Key } from "@/lib/i18n/ja";

interface Score {
  answered: number;
  correct: number;
  streak: number;
}
const emptyScore = (): Score => ({ answered: 0, correct: 0, streak: 0 });

const deal = () => makeTextureQuestion(PF_INDEX.flops, cryptoRandom);

/** the button text of one answer: the labels the aggregate report uses */
const labelKey = (kind: TextureQuestion["kind"], choice: string): Key => (kind === "paired" ? `rep.paired.${choice}` : `rep.${kind === "connect" ? "connect" : kind}.${choice}`) as Key;

/** a four-answer drill: read a flop the way the solver's aggregate report classifies it */
export function TextureQuiz() {
  const { t } = useSettings();
  const [question, setQuestion] = useState<TextureQuestion | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState<Score>(emptyScore);

  const start = () => {
    setQuestion(deal());
    setSelected(null);
    setScore(emptyScore());
  };
  const next = () => {
    setQuestion(deal());
    setSelected(null);
  };
  const answer = (choice: string) => {
    if (!question || selected !== null) return;
    const ok = isCorrectTexture(question, choice);
    setSelected(choice);
    setScore((s) => ({ answered: s.answered + 1, correct: s.correct + (ok ? 1 : 0), streak: ok ? s.streak + 1 : 0 }));
  };

  const answerText = question ? t(labelKey(question.kind, question.answer)) : "";
  const ok = question !== null && selected !== null && isCorrectTexture(question, selected);
  const explanation = question ? t(`tex.quiz.exp.${question.kind}.${question.answer}` as Key, { span: question.span }) : "";

  return (
    <section className="space-y-3 rounded-card border border-line bg-surface p-3" aria-label={t("tex.quiz.title")} data-testid="texture-quiz">
      <div>
        <h2 className="font-bold">{t("tex.quiz.title")}</h2>
        <p className="mt-1 text-xs text-muted">{t("tex.quiz.intro")}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums" data-testid="texture-quiz-score">
        {t("tex.quiz.score", { correct: score.correct, answered: score.answered, streak: score.streak })}
      </p>
      {question === null ? (
        <button type="button" data-testid="texture-quiz-start" onClick={start} className="min-h-tap-lg w-full rounded-control bg-accent font-bold text-accent-ink">
          {t("tex.quiz.start")}
        </button>
      ) : (
        <>
          <div className="flex items-center gap-1.5" role="img" aria-label={t("tex.quiz.board")} data-testid="texture-quiz-board">
            {question.board.map((c, i) => (
              <PlayingCard key={`${i}-${c}`} card={cardOf(c)} size="tbl" />
            ))}
          </div>
          <p className="rounded-control bg-surface-2 p-3 text-sm font-semibold" data-testid="texture-quiz-question">
            {t(`tex.quiz.q.${question.kind}` as Key)}
          </p>
          <div role="group" aria-label={t("tex.quiz.answers")} className="grid grid-cols-2 gap-2">
            {question.choices.map((choice) => {
              const isAnswer = choice === question.answer;
              const isSelected = selected === choice;
              const mark = selected === null ? "" : isAnswer ? " ✓" : isSelected ? " ✕" : "";
              const tone =
                selected === null
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
                  data-testid="texture-quiz-choice"
                  data-choice={choice}
                  onClick={() => answer(choice)}
                  className={`min-h-tap-lg rounded-control border px-3 text-base font-extrabold disabled:cursor-default ${tone}`}
                >
                  {t(labelKey(question.kind, choice))}
                  {mark}
                </button>
              );
            })}
          </div>
          {selected !== null && (
            <div className="space-y-2 rounded-control border border-line p-3">
              <p role="status" data-testid="texture-quiz-result" className="font-bold">
                {ok ? t("tex.quiz.correct", { answer: answerText }) : t("tex.quiz.incorrect", { answer: answerText })}
              </p>
              <p className="text-xs text-muted" data-testid="texture-quiz-explanation">{explanation}</p>
              <button type="button" data-testid="texture-quiz-next" onClick={next} className="min-h-tap-lg w-full rounded-control bg-accent font-bold text-accent-ink">
                {t("tex.quiz.next")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
