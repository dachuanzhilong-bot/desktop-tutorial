"use client";
import { motion } from "framer-motion";
import { StatBars } from "@/components/HandPanel";
import { GridAction, RangeGrid } from "@/components/RangeGrid";
import { Term } from "@/components/Term";
import { ApproxNote } from "@/components/ApproxNote";
import type { Judgement, Question } from "@/lib/practice/engine";
import type { Grade } from "@/lib/practice/grading";
import { useSettings } from "@/lib/settings";
import { fmtBB } from "@/lib/solution/tree";
import { ActionKind } from "@/lib/solution/types";
import type { Key } from "@/lib/i18n/ja";

export const GRADE_GLYPH: Record<Grade, string> = { best: "★", correct: "✓", inaccurate: "△", mistake: "!", blunder: "✕" };
export const gradeColor = (g: Grade) => `var(--g-${g})`;

export function GradeBadge({ grade, score }: { grade: Grade; score?: number }) {
  const { t } = useSettings();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-extrabold" style={{ color: gradeColor(grade), borderColor: gradeColor(grade) }} data-testid="grade">
      <span aria-hidden>{GRADE_GLYPH[grade]}</span>
      {t(`grade.${grade}` as Key)}
      {score !== undefined && <span className="ml-1 font-black">{score}</span>}
    </span>
  );
}

export interface AnswerInfo {
  j: Judgement;
  score: number;
  ms: number;
  timeout: boolean;
  hint: boolean;
  endText: string | null;
}

function ExplainLines({ q, a, actions, terms }: { q: Question; a: AnswerInfo; actions: GridAction[]; terms: string[] }) {
  const { t } = useSettings();
  const meta = q.stats;
  const callIdx = actions.findIndex((x) => x.kind === ActionKind.Call);
  return (
    <ul className="space-y-2 text-sm leading-relaxed">
      {callIdx >= 0 && <PotOdds q={q} />}
      <Mixed q={q} actions={actions} />
      <li>
        {t("explain.evGap", {
          ev: meta[a.j.chosen].ev.toFixed(2),
          best: meta[a.j.bestIndex].ev.toFixed(2),
          loss: a.j.evLoss.toFixed(2),
        })}
      </li>
      {q.eqr !== null && callIdx >= 0 && (
        <li>
          <Term id="eqr">EQR</Term>: {t("explain.eqr", { eqr: q.eqr.toFixed(2) })}
        </li>
      )}
      {q.roll !== null && q.rngAction !== null && <li>{t("explain.rng", { roll: Math.floor(q.roll * 100) + 1, action: actions[q.rngAction].label })}</li>}
      <li>{t("explain.range", { w: Math.round(q.weight * 100) })}</li>
      {terms.length > 0 && (
        <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="explain-terms">
          <span className="text-muted">{t("explain.terms")}</span>
          {terms.map((id) => (
            <Term key={id} id={id} />
          ))}
        </li>
      )}
    </ul>
  );
}

function PotOdds({ q }: { q: Question }) {
  const { t } = useSettings();
  return <li data-pot-odds>{q.potOdds ? t("explain.potOdds", { call: fmtBB(q.potOdds.call), pot: fmtBB(q.potOdds.pot), need: Math.round(q.potOdds.need * 100), eq: Math.round(q.equity * 100) }) : t("explain.noCall")}</li>;
}

function Mixed({ q, actions }: { q: Question; actions: GridAction[] }) {
  const { t } = useSettings();
  const top = q.stats.reduce((b, s, i) => (s.freq > q.stats[b].freq ? i : b), 0);
  if (q.stats[top].freq < 0.97) {
    const mix = q.stats
      .map((s, i) => (s.freq >= 0.02 ? `${actions[i].label} ${Math.round(s.freq * 100)}%` : null))
      .filter(Boolean)
      .join(" / ");
    return <li>{t("explain.mixed", { mix })}</li>;
  }
  return <li>{t("explain.pure", { action: actions[top].label, f: Math.round(q.stats[top].freq * 100) })}</li>;
}

export function ResultPanel({
  q,
  a,
  actions,
  pane,
  onNext,
  onTogglePane,
  nextLabel,
  approx,
  terms = ["ev", "evLoss", "equity"],
}: {
  q: Question;
  a: AnswerInfo;
  actions: GridAction[];
  pane: "result" | "explain";
  onNext: () => void;
  onTogglePane: () => void;
  nextLabel: string;
  /** "graded against an approximation" text, shown with the explanation */
  approx?: string;
  /** glossary entries relevant to this question (tap to explain) */
  terms?: string[];
}) {
  const { t } = useSettings();
  const j = a.j;
  const loss = j.evLoss;
  const swipe = (dx: number) => {
    if (dx > 70) onNext();
    else if (dx < -70) onTogglePane();
  };
  return (
    <motion.section
      aria-label={t("practice.evLoss")}
      className="rounded-sheet border border-line bg-surface p-4 shadow-xl"
      style={{ touchAction: "pan-y" }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.35}
      dragSnapToOrigin
      onDragEnd={(_, info) => swipe(info.offset.x)}
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      data-testid="result"
    >
      <div className="flex items-start justify-between gap-3">
        <GradeBadge grade={j.grade} score={a.score} />
        <div className="flex flex-wrap justify-end gap-1.5 text-xs font-semibold text-muted">
          {a.timeout && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t("practice.timeUp")}</span>}
          {a.hint && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t("practice.hintUsed")}</span>}
          {j.rngMiss && <span className="rounded-full bg-surface-2 px-2 py-0.5">{t("practice.rngMiss")}</span>}
        </div>
      </div>

      <div className="mt-1 flex items-end justify-center gap-2 text-center">
        <div>
          <div className="text-xs font-bold text-muted">
            <Term id="evLoss">{t("practice.evLoss")}</Term>
          </div>
          <div className="text-7xl font-black leading-none tabular-nums sm:text-8xl" style={{ color: gradeColor(j.grade) }} data-testid="ev-loss">
            {loss < 0.005 ? "0.00" : `−${loss.toFixed(2)}`}
          </div>
          <div className="mt-0.5 text-sm font-bold text-muted">bb</div>
        </div>
      </div>

      {pane === "result" ? (
        <div className="mt-3 grid grid-cols-[1fr_8.5rem] items-start gap-3">
          <div className="min-w-0 space-y-2">
            <p className="text-sm">
              <span className="text-muted">{t("practice.youChose")}: </span>
              <b>{actions[j.chosen].label}</b>
              {j.chosen !== j.bestIndex && (
                <>
                  <span className="text-muted"> · {t("practice.best")}: </span>
                  <b>{actions[j.bestIndex].label}</b>
                </>
              )}
            </p>
            {/* in the solution's single precision, as the bars always showed it (the identity on pre-flop numbers, which are read from Float32Arrays) */}
            <StatBars stats={q.stats.map((s) => ({ freq: Math.fround(s.freq), ev: Math.fround(s.ev) }))} actions={actions} best={j.bestIndex} />
          </div>
          <div role="img" aria-label={t("practice.rangePos")} inert>
            <div>
              <RangeGrid sol={q.sol} actions={actions} mode="strategy" selected={null} marker={q.hand} showNumbers={false} bare ariaLabel={t("practice.rangePos")} />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <ExplainLines q={q} a={a} actions={actions} terms={terms} />
          {approx && <ApproxNote>{approx}</ApproxNote>}
          <div className="mx-auto w-56" role="img" aria-label={t("practice.rangePos")} inert>
            <RangeGrid sol={q.sol} actions={actions} mode="strategy" selected={null} marker={q.hand} showNumbers={false} bare ariaLabel={t("practice.rangePos")} />
          </div>
        </div>
      )}

      {a.endText && <p className="mt-3 rounded-control bg-surface-2 px-3 py-2 text-sm font-semibold">{a.endText}</p>}

      <div className="mt-3 grid grid-cols-[1fr_2fr] gap-2.5">
        <button type="button" onClick={onTogglePane} data-testid="explain-toggle" className="min-h-cta rounded-card border border-line font-bold text-muted">
          {pane === "result" ? t("practice.explain") : t("common.back")}
        </button>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the answer buttons this replaces are gone: move focus here instead of losing it (the result is announced by a live region) */}
        <button type="button" onClick={onNext} autoFocus data-testid="next-hand" className="min-h-cta rounded-card bg-accent text-lg font-extrabold text-accent-ink active:scale-[0.98]">
          {nextLabel}
        </button>
      </div>
      <p className="mt-2 text-center text-[0.7rem] text-muted">{t("practice.swipeHint")}</p>
    </motion.section>
  );
}
