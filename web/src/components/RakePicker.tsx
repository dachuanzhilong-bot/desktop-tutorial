"use client";
import { rakeChoices, rakeOf, solutionId } from "@/lib/solution/catalog";
import { useSolutionStore } from "@/lib/solution/context";
import { rakeKey } from "@/lib/solution/rake";
import { useSettings } from "@/lib/settings";

/**
 * The rake of the preflop solution (REFACTOR_PLAN 3-2). Shown only where the selected depth has solutions with two or
 * more rakes (`rakeChoices`); with today's data (no rake only) it renders nothing.
 */
export function RakePicker({ className = "" }: { className?: string }) {
  const { t } = useSettings();
  const { depth, rake, setRake } = useSolutionStore();
  const choices = rakeChoices(depth);
  if (choices.length < 2) return null;
  // the rake of the solution in use (a rake the depth does not have falls back to its solution without rake)
  const current = rakeOf(solutionId(depth, rake));
  return (
    <div className={className}>
      <p className="mb-1 text-sm font-semibold text-muted" id="rake-label">
        {t("rake.label")}
      </p>
      <div role="radiogroup" aria-labelledby="rake-label" className="flex flex-wrap gap-1 rounded-card bg-surface p-1" data-testid="rake-picker">
        {choices.map((r) => {
          const key = rakeKey(r);
          const on = key === current;
          return (
            <button key={key} type="button" role="radio" aria-checked={on} data-testid={`rake-${key}`} onClick={() => setRake(key)} className={`min-h-tap flex-1 rounded-control px-2 text-sm font-bold ${on ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
              {r.pct === 0 ? t("rake.none") : r.cap === null ? t("rake.optionNoCap", { pct: r.pct }) : t("rake.option", { pct: r.pct, cap: r.cap })}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-muted">{t("rake.hint")}</p>
    </div>
  );
}
