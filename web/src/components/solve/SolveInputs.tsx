"use client";
import { BetSizes } from "@/components/solve/BetSizes";
import { BoardPicker } from "@/components/solve/BoardPicker";
import { RangeField } from "@/components/solve/RangeField";
import type { Key } from "@/lib/i18n/ja";
import { useSettings } from "@/lib/settings";
import { costHint } from "@/lib/solve/config";
import type { SolveAccuracy } from "@/lib/solve/draft";
import { fullConfig, potOf } from "@/lib/solve/form";
import type { FormPatch, SolveForm } from "@/lib/solve/form";
import type { SavedRange } from "@/lib/storage/types";

/** "12秒" / "3分": a duration for the time estimates */
export function useFmtTime() {
  const { t } = useSettings();
  return (sec: number) => (sec >= 90 ? t("solve.min", { n: Math.round(sec / 60) }) : t("solve.sec", { n: Math.max(1, Math.round(sec)) }));
}

interface Props {
  form: SolveForm;
  set: (patch: FormPatch) => void;
  pickAcc: (acc: SolveAccuracy) => void;
  quick: (kind: "srp" | "3bp") => void;
  can3bp: boolean;
  savedRanges: SavedRange[];
  /** the solver is running: nothing can be changed */
  busy: boolean;
}

const field = "mt-1 block min-h-tap w-full rounded-control border border-line px-3 text-ink";

/** everything the Solve screen asks before a run: spot, board, ranges, pot and stack, bet sizes, accuracy */
export function SolveInputs({ form, set, pickAcc, quick, can3bp, savedRanges, busy }: Props) {
  const { t } = useSettings();
  const fmtTime = useFmtTime();
  const { board, cfg, acc, iterations, target } = form;
  const startStreet = Math.max(0, Math.min(2, board.length - 3));
  const hint = costHint(board.length, fullConfig(form));
  const spr = potOf(form) > 0 ? Number(form.stack) / Number(form.pot) : 0;

  return (
    <fieldset disabled={busy} className="min-w-0 space-y-5 border-0 p-0">
      <section className="space-y-2" aria-label={t("solve.quick")}>
        <h2 className="font-bold">{t("solve.quick")}</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="quick-srp" onClick={() => quick("srp")} className="min-h-tap rounded-control border border-line bg-surface px-3.5 text-sm font-semibold">
            {t("solve.quick.srp")}
          </button>
          <button type="button" data-testid="quick-3bp" disabled={!can3bp} onClick={() => quick("3bp")} className="min-h-tap rounded-control border border-line bg-surface px-3.5 text-sm font-semibold disabled:opacity-45">
            {t("solve.quick.3bp")}
          </button>
        </div>
      </section>

      <BoardPicker board={board} onChange={(b) => set({ board: b })} />

      <section className="space-y-2" aria-label={t("solve.ranges")}>
        <h2 className="font-bold">{t("solve.ranges")}</h2>
        <RangeField label={`${form.oopName} · ${t("pf.oop")}`} text={form.oopText} onText={(v) => set({ oopText: v })} saved={savedRanges} testId="range-oop" />
        <RangeField label={`${form.ipName} · ${t("pf.ip")}`} text={form.ipText} onText={(v) => set({ ipText: v })} saved={savedRanges} testId="range-ip" />
      </section>

      <section className="space-y-2" aria-label={t("solve.potStack")}>
        <h2 className="font-bold">{t("solve.potStack")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-muted">
            {t("solve.pot")}
            <input data-testid="pot-input" type="number" inputMode="decimal" min={1} step={0.5} value={form.pot} onChange={(e) => set({ pot: e.target.value })} className={`${field} bg-surface`} />
          </label>
          <label className="block text-sm text-muted">
            {t("solve.stack")}
            <input data-testid="stack-input" type="number" inputMode="decimal" min={1} step={0.5} value={form.stack} onChange={(e) => set({ stack: e.target.value })} className={`${field} bg-surface`} />
          </label>
        </div>
        <p className="text-xs text-muted">{t("solve.spr", { n: spr.toFixed(1) })}</p>
      </section>

      <BetSizes cfg={cfg} startStreet={startStreet} onChange={(c) => set({ cfg: c })} />

      <section className="space-y-3" aria-label={t("solve.accuracy")}>
        <h2 className="font-bold">{t("solve.accuracy")}</h2>
        <div role="group" aria-label={t("solve.accuracy")} className="grid grid-cols-3 gap-1 rounded-card bg-surface p-1">
          {(["draft", "std", "high"] as const).map((a) => (
            <button key={a} type="button" aria-pressed={acc === a} data-testid={`acc-${a}`} onClick={() => pickAcc(a)} className={`min-h-tap rounded-control text-sm font-bold ${acc === a ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
              {t(`solve.acc.${a}` as Key)}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted" data-testid="solve-estimate">
          {t("solve.iterations")}: <b className="text-ink">{iterations}</b> · {t("solve.est", { s: fmtTime((iterations * hint.msPerIter) / 1000) })} · {t("solve.target")}: <b className="text-ink">{target}</b>
        </p>
        {hint.level === "slow" && <p className="text-sm text-muted">{t("solve.heavy")}</p>}
        <details className="rounded-card border border-line bg-surface p-3">
          <summary className="min-h-tap cursor-pointer font-semibold">{t("solve.advanced")}</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm text-muted">
              {t("solve.iterations")}
              <input type="number" min={10} max={5000} step={10} value={iterations} onChange={(e) => set({ iterations: Math.max(10, Math.min(5000, Number(e.target.value) || 10)) })} className={`${field} bg-surface-2`} />
            </label>
            <label className="block text-sm text-muted">
              {t("solve.target")}
              <input type="number" min={0.05} max={10} step={0.05} value={target} onChange={(e) => set({ target: Math.max(0.05, Number(e.target.value) || 1) })} className={`${field} bg-surface-2`} />
            </label>
            {board.length < 5 && (
              <label className="block text-sm text-muted">
                {board.length === 3 ? t("solve.turnCards") : t("solve.riverCards")}
                <select
                  value={board.length === 3 ? cfg.turnCards : cfg.riverCards}
                  onChange={(e) => set({ cfg: board.length === 3 ? { ...cfg, turnCards: Number(e.target.value) } : { ...cfg, riverCards: Number(e.target.value) } })}
                  className={`${field} bg-surface-2`}
                >
                  {(board.length === 3 ? [4, 6, 8] : [1, 2, 4, 8]).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {board.length === 3 && (
              <label className="block text-sm text-muted">
                {t("solve.riverCards")}
                <select value={cfg.riverCards} onChange={(e) => set({ cfg: { ...cfg, riverCards: Number(e.target.value) } })} className={`${field} bg-surface-2`}>
                  {[1, 2, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {board.length < 5 && <p className="mt-2 text-xs text-muted">{t("solve.sampleHint")}</p>}
        </details>
      </section>
    </fieldset>
  );
}
