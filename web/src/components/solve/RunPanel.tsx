"use client";
import { useFmtTime } from "@/components/solve/SolveInputs";
import { useSettings } from "@/lib/settings";
import type { SolveRun } from "@/lib/solve/run";

interface Props {
  run: SolveRun;
  canRun: boolean;
  /** both ranges hold at least one combo */
  haveRanges: boolean;
  onRun: () => void;
  onStop: () => void;
}

/** the run button, the stop button and the progress of a run */
export function RunPanel({ run, canRun, haveRanges, onRun, onStop }: Props) {
  const { t } = useSettings();
  const fmtTime = useFmtTime();
  const { phase, progress, lastExploit, nodes, error } = run;
  const active = phase === "running" || phase === "locking";
  const x = lastExploit ?? progress?.exploit ?? -1;
  return (
    <section className="space-y-3 rounded-card border border-line bg-surface p-4" aria-label={t("solve.run")}>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button type="button" data-testid="solve-run" disabled={!canRun} onClick={onRun} className="min-h-cta rounded-card bg-accent text-lg font-extrabold text-accent-ink shadow disabled:opacity-50">
          {phase === "building" ? t("solve.preparing") : t("solve.run")}
        </button>
        {active && (
          <button type="button" data-testid="solve-stop" onClick={onStop} className="min-h-cta rounded-card border border-line px-5 font-bold">
            {t("solve.stop")}
          </button>
        )}
      </div>
      {!haveRanges && <p className="text-xs text-muted">{t("solve.noRange")}</p>}
      {active && (
        <div data-testid="solve-progress" role="status" aria-live="polite">
          <div className="h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ? Math.round((100 * progress.done) / progress.total) : 0} aria-label={t("solve.running")}>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${progress ? (100 * progress.done) / progress.total : 0}%` }} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {progress ? t("solve.progress", { done: progress.done, total: progress.total, x: x >= 0 ? x.toFixed(2) : "…" }) : phase === "locking" ? t("solve.lock.running") : t("solve.running")}
            {progress?.elapsed && progress.done > 0 && progress.done < progress.total ? ` · ${t("solve.eta", { s: fmtTime(((progress.elapsed / progress.done) * (progress.total - progress.done)) / 1000) })}` : ""}
            {nodes > 0 ? ` · ${t("solve.nodes", { n: nodes.toLocaleString() })}` : ""}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-[color:var(--g-blunder)]" data-testid="solve-error">
          {error}
        </p>
      )}
    </section>
  );
}
