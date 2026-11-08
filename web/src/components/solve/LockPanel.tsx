"use client";
import { useEffect, useMemo, useState } from "react";
import type { GridAction } from "@/components/RangeGrid";
import { COMBOS_OF_CLASS, NC } from "@/lib/postflop/combos";
import type { DenseNode } from "@/lib/postflop/decode";
import { useSettings } from "@/lib/settings";

export type LockTarget = "all" | "filter" | "hand";
const ITERS = [50, 150, 400];

/** shift one slider and rescale the others so the mix always sums to 100 */
export function rebalance(mix: number[], i: number, value: number): number[] {
  const v = Math.min(100, Math.max(0, value));
  const rest = 100 - v;
  const others = mix.reduce((s, x, k) => (k === i ? s : s + x), 0);
  return mix.map((x, k) => (k === i ? v : others > 1e-9 ? (x * rest) / others : rest / Math.max(1, mix.length - 1)));
}

/** the strategy matrix (actions x 1326) that locks `hands` to `mix` and keeps every other hand as it is */
export function buildLock(d: DenseNode, na: number, hands: number[], mix: number[]): Float32Array {
  const out = new Float32Array(na * NC);
  for (let a = 0; a < na; a++) for (let h = 0; h < NC; h++) out[a * NC + h] = d.freq[a * NC + h];
  for (const h of hands) for (let a = 0; a < na; a++) out[a * NC + h] = mix[a] / 100;
  return out;
}

export function targetHands(d: DenseNode, target: LockTarget, selected: number | null, inFilter: (h: number) => boolean): number[] {
  const hands: number[] = [];
  if (target === "hand") {
    if (selected !== null) for (const h of COMBOS_OF_CLASS[selected]) if (d.weight[h] > 0) hands.push(h);
    return hands;
  }
  for (let h = 0; h < NC; h++) if (d.weight[h] > 0 && (target === "all" || inFilter(h))) hands.push(h);
  return hands;
}

export function averageMix(d: DenseNode, na: number, hands: number[]): number[] {
  const mix = new Array(na).fill(0);
  let tot = 0;
  for (const h of hands) {
    const w = d.weight[h];
    tot += w;
    for (let a = 0; a < na; a++) mix[a] += w * d.freq[a * NC + h];
  }
  return tot > 0 ? mix.map((x) => (100 * x) / tot) : mix.map(() => 100 / na);
}

interface Props {
  d: DenseNode;
  actions: GridAction[];
  selected: number | null;
  inFilter: (h: number) => boolean;
  seat: string;
  locked: boolean;
  busy: boolean;
  /** why locking is not possible (no live solver) or null */
  unavailable: string | null;
  onApply: (strategy: Float32Array, iterations: number) => void;
  onUnlock: (iterations: number) => void;
}

export function LockPanel({ d, actions, selected, inFilter, seat, locked, busy, unavailable, onApply, onUnlock }: Props) {
  const { t } = useSettings();
  const na = actions.length;
  const [target, setTarget] = useState<LockTarget>("all");
  const [iters, setIters] = useState(150);
  const hands = useMemo(() => targetHands(d, target, selected, inFilter), [d, target, selected, inFilter]);
  const base = useMemo(() => averageMix(d, na, hands), [d, na, hands]);
  const [mix, setMix] = useState<number[]>(base);
  useEffect(() => setMix(base), [base]);

  const sum = mix.reduce((s, x) => s + x, 0);
  const chip = (on: boolean) => `min-h-10 rounded-full border px-3 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`;
  const disabled = busy || hands.length === 0 || !!unavailable;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label={t("solve.lock.title")} data-testid="lock-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">{t("solve.lock.at", { seat })}</h3>
        {locked && (
          <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-extrabold text-accent-ink" data-testid="lock-badge">
            {t("solve.lock.locked")}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">{t("solve.lock.hint")}</p>
      {unavailable && <p className="text-sm text-muted">{unavailable}</p>}

      <div className="space-y-1.5">
        <p className="text-sm font-semibold text-muted">{t("solve.lock.target")}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("solve.lock.target")}>
          {(["all", "filter", "hand"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={target === k} data-testid={`lock-target-${k}`} onClick={() => setTarget(k)} className={chip(target === k)}>
              {t(`solve.lock.${k}` as "solve.lock.all")}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted" data-testid="lock-count">
          {hands.length > 0 ? t("solve.lock.count", { n: hands.length }) : t("solve.lock.none")}
        </p>
      </div>

      <div className="space-y-2">
        {actions.map((a, i) => (
          <label key={i} className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 text-sm">
            <span className="flex items-center gap-1.5 font-semibold">
              <span className="seg inline-block h-3.5 w-3.5 shrink-0 rounded-sm" data-k={a.tone} aria-hidden />
              <span className="truncate">{a.label}</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(mix[i] ?? 0)}
              disabled={hands.length === 0}
              onChange={(e) => setMix((m) => rebalance(m, i, Number(e.target.value)))}
              aria-label={`${a.label} %`}
              data-testid={`lock-slider-${i}`}
              className="h-8 w-full accent-[var(--accent)]"
            />
            <span className="text-right font-bold tabular-nums">{Math.round(mix[i] ?? 0)}%</span>
          </label>
        ))}
        <p className="text-right text-xs text-muted">{t("solve.lock.sum", { n: Math.round(sum) })}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t("solve.lock.iters")}
          <select value={iters} onChange={(e) => setIters(Number(e.target.value))} className="min-h-10 rounded-lg border border-line bg-surface-2 px-2 text-sm text-ink">
            {ITERS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" data-testid="lock-apply" disabled={disabled} onClick={() => onApply(buildLock(d, na, hands, mix), iters)} className="min-h-12 rounded-xl bg-accent font-bold text-accent-ink disabled:opacity-50">
          {busy ? t("solve.lock.running") : t("solve.lock.apply")}
        </button>
        <button type="button" data-testid="lock-unlock" disabled={busy || !locked || !!unavailable} onClick={() => onUnlock(iters)} className="min-h-12 rounded-xl border border-line font-bold disabled:opacity-50">
          {t("solve.lock.unlock")}
        </button>
      </div>
    </section>
  );
}
