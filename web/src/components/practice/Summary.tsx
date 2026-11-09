"use client";
import Link from "next/link";
import { GRADES } from "@/lib/practice/grading";
import { Result, sessionStats } from "@/lib/practice/session";
import { useSettings } from "@/lib/settings";
import type { Key } from "@/lib/i18n/ja";
import { GRADE_GLYPH, gradeColor } from "./ResultPanel";

export function SessionSummary({ results, onAgain, onExit }: { results: Result[]; onAgain: () => void; onExit: () => void }) {
  const { t } = useSettings();
  const s = sessionStats(results);
  const max = Math.max(1, ...Object.values(s.byGrade));
  return (
    <div className="mx-auto max-w-md space-y-5" data-testid="summary">
      <header className="text-center">
        <h1 className="text-2xl font-extrabold">{t("practice.summary")}</h1>
        <p className="mt-3 text-sm text-muted">{t("practice.total")}</p>
        <p className="text-6xl font-black tabular-nums text-accent-text" data-testid="summary-total">
          {s.totalScore}
        </p>
      </header>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          [t("practice.hands"), String(s.n)],
          [t("practice.accuracy"), `${Math.round(s.accuracy * 100)}%`],
          [t("practice.avgLoss"), `${s.avgLoss.toFixed(2)}bb`],
          [t("practice.streak"), String(s.bestStreak)],
          [t("stats.avgScore"), s.avgScore.toFixed(0)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-card bg-surface p-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="text-xl font-extrabold">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1.5 rounded-card bg-surface p-4" aria-label={t("stats.gradeDist")}>
        {GRADES.map((g) => (
          <li key={g} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-2 text-sm">
            <span className="font-bold" style={{ color: gradeColor(g) }}>
              {GRADE_GLYPH[g]} {t(`grade.${g}` as Key)}
            </span>
            <span className="h-3 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full" style={{ width: `${(s.byGrade[g] / max) * 100}%`, background: gradeColor(g) }} />
            </span>
            <span className="text-right tabular-nums">{s.byGrade[g]}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2.5">
        <Link href="/stats/" className="grid min-h-cta place-items-center rounded-card border border-line font-bold">
          {t("practice.toStats")}
        </Link>
        <button type="button" onClick={onAgain} className="min-h-cta rounded-card bg-accent font-extrabold text-accent-ink">
          {t("practice.again")}
        </button>
      </div>
      <button type="button" onClick={onExit} className="mx-auto block min-h-tap px-4 text-sm font-semibold text-muted">
        {t("common.back")}
      </button>
    </div>
  );
}
