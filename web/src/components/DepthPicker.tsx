"use client";
import { DEPTHS } from "@/lib/solution/loader";
import { useSolutionStore } from "@/lib/solution/context";
import { useSettings } from "@/lib/settings";

/** effective stack of the preflop solution (20 / 40 / 60 / 100 / 200 bb) */
export function DepthPicker({ className = "" }: { className?: string }) {
  const { t } = useSettings();
  const { depth, setDepth, loading } = useSolutionStore();
  return (
    <div className={className}>
      <p className="mb-1 text-sm font-semibold text-muted" id="depth-label">
        {t("depth.label")}
        {loading ? <span className="ml-2 text-xs font-normal" role="status">{t("depth.loading")}</span> : null}
      </p>
      <div role="radiogroup" aria-labelledby="depth-label" className="grid grid-cols-5 gap-1 rounded-card bg-surface p-1" data-testid="depth-picker">
        {DEPTHS.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={depth === d} data-testid={`depth-${d}`} onClick={() => setDepth(d)} className={`min-h-tap rounded-control text-sm font-bold ${depth === d ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
            {t("depth.option", { n: d })}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">{t("depth.hint")}</p>
    </div>
  );
}
