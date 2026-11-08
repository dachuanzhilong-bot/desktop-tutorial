"use client";
import type { Key } from "@/lib/i18n/ja";
import { useSettings } from "@/lib/settings";
import type { SolveConfig } from "@/lib/solve/config";

const CHOICES = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5];
const MAX_PER_STREET = 3;

/** bet-size chips for each street that is actually solved */
export function BetSizes({ cfg, startStreet, onChange }: { cfg: SolveConfig; startStreet: number; onChange: (c: SolveConfig) => void }) {
  const { t } = useSettings();
  const toggle = (street: number, f: number) => {
    const cur = cfg.bets[street];
    const next = cur.includes(f) ? cur.filter((x) => x !== f) : cur.length >= MAX_PER_STREET ? cur : [...cur, f].sort((a, b) => a - b);
    const bets = cfg.bets.map((b, i) => (i === street ? next : b)) as SolveConfig["bets"];
    onChange({ ...cfg, bets });
  };
  const setRaise = (street: number, on: boolean) => {
    const raiseSizes = cfg.raiseSizes.map((x, i) => (i === street ? on : x)) as SolveConfig["raiseSizes"];
    onChange({ ...cfg, raiseSizes });
  };
  const chip = (on: boolean) => `min-h-11 min-w-12 rounded-full border px-3 text-sm font-bold ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`;
  return (
    <section className="space-y-3" aria-label={t("solve.bets")}>
      <h2 className="font-bold">{t("solve.bets")}</h2>
      {[0, 1, 2].map((street) =>
        street < startStreet ? null : (
          <div key={street} className="space-y-1.5" data-testid={`bets-${street}`}>
            <p className="text-sm font-semibold text-muted">{t(`pf.street.${street}` as Key)}</p>
            <div className="flex flex-wrap gap-1.5">
              {CHOICES.map((f) => (
                <button key={f} type="button" aria-pressed={cfg.bets[street].includes(f)} onClick={() => toggle(street, f)} className={chip(cfg.bets[street].includes(f))}>
                  {Math.round(f * 100)}
                </button>
              ))}
              <button type="button" aria-pressed={cfg.raiseSizes[street]} onClick={() => setRaise(street, !cfg.raiseSizes[street])} className={chip(cfg.raiseSizes[street])}>
                {t("solve.raiseOn")}
              </button>
            </div>
            {cfg.bets[street].length === 0 && !cfg.allowAllin && <p className="text-xs text-[color:var(--raise-1)]">{t("solve.betsWarn")}</p>}
          </div>
        ),
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={cfg.allowAllin} onChange={(e) => onChange({ ...cfg, allowAllin: e.target.checked })} className="h-5 w-5" />
        {t("solve.allin")}
      </label>
    </section>
  );
}
