"use client";
import { ALL_CLASSES, NUM_CLASSES, classCombos } from "@/lib/poker/hands";
import type { NodeSolution } from "@/lib/solution/types";
import { useSettings } from "@/lib/settings";
import { PlayingCard } from "./PlayingCard";
import type { GridAction } from "./RangeGrid";
import { Term } from "./Term";

const K = NUM_CLASSES;

/** each action's frequency and EV for hand class `h` of a solution */
export function FreqBars({ sol, h, actions, best }: { sol: NodeSolution; h: number; actions: GridAction[]; best?: number }) {
  return <StatBars stats={actions.map((_, i) => ({ freq: sol.freq[i * K + h], ev: sol.ev[i * K + h] }))} actions={actions} best={best} />;
}

/** each action's frequency and EV (bb) of one hand, with a bar per action */
export function StatBars({ stats, actions, best }: { stats: { freq: number; ev: number }[]; actions: GridAction[]; best?: number }) {
  const { t } = useSettings();
  return (
    <ul className="space-y-2">
      {actions.map((a, i) => {
        const f = stats[i].freq;
        const ev = stats[i].ev;
        return (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">
                {a.label}
                {best === i && (
                  <span className="ml-1 text-accent-text" aria-label={t("practice.best")}>
                    ★
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                <b>{Math.round(f * 100)}%</b>
                <span className="ml-1.5 text-xs text-muted">
                  {ev >= 0 ? "+" : "−"}
                  {Math.abs(ev).toFixed(2)}
                </span>
              </span>
            </div>
            <div className="mt-0.5 h-2.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${Math.round(f * 100)}%`}>
              <span className="seg block h-full rounded-full" data-k={a.tone} style={{ width: `${Math.max(f * 100, f > 0 ? 2 : 0)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function HandPanel({ sol, h, actions }: { sol: NodeSolution; h: number; actions: GridAction[] }) {
  const { t } = useSettings();
  const info = ALL_CLASSES[h];
  let best = 0;
  for (let a = 1; a < sol.na; a++) if (sol.ev[a * K + h] > sol.ev[best * K + h]) best = a;
  const combos = classCombos(h);
  return (
    <section aria-label={t("study.hand")} className="rounded-card border border-line bg-surface p-4" data-testid="hand-panel">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-2xl font-extrabold">{info.name}</h3>
        <span className="text-sm text-muted">
          {info.combos} {t("common.combos")}
        </span>
      </div>
      <FreqBars sol={sol} h={h} actions={actions} best={best} />
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-control bg-surface-2 py-2">
          <dt className="text-xs text-muted">
            <Term id="equity">{t("study.equity")}</Term>
          </dt>
          <dd className="text-lg font-bold">{(sol.equity[h] * 100).toFixed(1)}%</dd>
        </div>
        <div className="rounded-control bg-surface-2 py-2">
          <dt className="text-xs text-muted">
            <Term id="eqr">{t("study.eqr")}</Term>
          </dt>
          <dd className="text-lg font-bold">{sol.eqr ? sol.eqr[h].toFixed(2) : "–"}</dd>
        </div>
        <div className="rounded-control bg-surface-2 py-2">
          <dt className="text-xs text-muted">{t("study.weight")}</dt>
          <dd className="text-lg font-bold">{Math.round(sol.weight[h] * 100)}%</dd>
        </div>
      </dl>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-muted">{t("study.suitBreakdown")}</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {combos.map((c, i) => (
            <span key={i} className="inline-flex gap-0.5">
              <PlayingCard card={c[0]} size="sm" />
              <PlayingCard card={c[1]} size="sm" />
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{t("study.suitIso")}</p>
      </details>
    </section>
  );
}
