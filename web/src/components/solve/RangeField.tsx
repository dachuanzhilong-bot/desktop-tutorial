"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RangeCells } from "@/components/ranges/RangeCells";
import { RANGE_PRESETS, availablePresets, presetRange } from "@/lib/ranges/presets";
import { parseRange, rangeCombos, rangePercent, formatRange } from "@/lib/ranges/range";
import { useSolutionStore } from "@/lib/solution/context";
import { useSettings } from "@/lib/settings";
import type { SavedRange } from "@/lib/storage/types";

/** a range input for the Solve screen: preset / saved range / text, with a live preview */
export function RangeField({ label, text, onText, saved, testId }: { label: string; text: string; onText: (t: string) => void; saved: SavedRange[]; testId: string }) {
  const { t } = useSettings();
  const { store } = useSolutionStore();
  const parsed = useMemo(() => parseRange(text), [text]);
  // not every line exists at every stack depth (e.g. nobody calls a 3-bet at 20bb)
  const presets = useMemo(() => (store ? availablePresets(store) : RANGE_PRESETS), [store]);
  const [choice, setChoice] = useState("");
  const pick = async (id: string) => {
    setChoice(id);
    if (id.startsWith("preset:")) {
      const p = RANGE_PRESETS.find((x) => x.id === id.slice(7));
      if (p && store) {
        const r = await presetRange(store, p);
        if (r) onText(formatRange(r));
      }
    } else if (id.startsWith("saved:")) {
      const r = saved.find((x) => x.id === id.slice(6));
      if (r) onText(r.text);
    }
  };

  const combos = rangeCombos(parsed.range);
  return (
    <section className="space-y-2 rounded-2xl border border-line bg-surface p-3" aria-label={label} data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold">{label}</h3>
        <span className="text-xs text-muted" data-testid={`${testId}-size`}>
          {t("solve.rangeSize", { combos: combos.toFixed(0), pct: rangePercent(parsed.range).toFixed(1) })}
        </span>
      </div>
      <div className="flex gap-3">
        <div className="w-28 shrink-0">
          <RangeCells value={parsed.range} bare ariaLabel={label} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <label className="block text-xs text-muted">
            {t("solve.preset")}
            <select value={choice} onChange={(e) => pick(e.target.value)} data-testid={`${testId}-preset`} className="mt-0.5 block min-h-11 w-full rounded-xl border border-line bg-surface-2 px-2 text-sm text-ink">
              <option value="">{t("solve.presetCustom")}</option>
              <optgroup label="GTO">
                {presets.map((p) => (
                  <option key={p.id} value={`preset:${p.id}`}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
              {saved.length > 0 && (
                <optgroup label={t("solve.presetSaved")}>
                  {saved.map((r) => (
                    <option key={r.id} value={`saved:${r.id}`}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <Link href={`/builder/#text=${encodeURIComponent(text)}`} className="inline-block text-sm text-accent-text underline">
            {t("solve.edit")}
          </Link>
        </div>
      </div>
      <label className="block text-xs text-muted">
        {t("solve.rangeText")}
        <textarea
          value={text}
          data-testid={`${testId}-text`}
          onChange={(e) => {
            setChoice("");
            onText(e.target.value);
          }}
          rows={2}
          spellCheck={false}
          className="mt-0.5 block w-full rounded-xl border border-line bg-surface-2 p-2 font-mono text-xs text-ink"
        />
      </label>
      {parsed.errors.length > 0 && (
        <p role="alert" className="text-xs text-[color:var(--g-blunder)]">
          {t("solve.parseErr", { list: parsed.errors.join(", ") })}
        </p>
      )}
    </section>
  );
}
