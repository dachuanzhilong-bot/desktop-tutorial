"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { RangeCells } from "@/components/ranges/RangeCells";
import { SolveTabs } from "@/components/solve/SolveTabs";
import { IcmClient } from "@/lib/icm/client";
import type { IcmProgress } from "@/lib/icm/client";
import { IcmInput, IcmSolution, parsePayouts, PAYOUT_PRESETS, POSITIONS, rangePercent } from "@/lib/icm/model";
import type { Key } from "@/lib/i18n/ja";
import { classInfo } from "@/lib/poker/hands";
import { useSettings } from "@/lib/settings";

type Acc = "fast" | "std" | "high";
const ITERS: Record<Acc, number> = { fast: 400, std: 1200, high: 3000 };
const DRAFT = "tessera.icmDraft.v1";

interface Draft {
  n: number;
  stacks: string[];
  hero: number;
  ante: string;
  preset: string;
  payoutText: string;
  acc: Acc;
}

const DEFAULT: Draft = { n: 4, stacks: ["15", "9", "22", "12"], hero: 1, ante: "0", preset: "top3", payoutText: "50, 30, 20", acc: "std" };

const QUICK: Record<string, Draft> = {
  ft9: { n: 9, stacks: ["22", "18", "15", "30", "9", "12", "25", "14", "20"], hero: 4, ante: "0.125", preset: "ft9", payoutText: "30, 20, 14, 10, 8, 7, 5, 4, 2", acc: "std" },
  bubble: DEFAULT,
  hu: { n: 2, stacks: ["10", "10"], hero: 0, ante: "0", preset: "wta", payoutText: "1", acc: "std" },
};

const combos = (h: number) => classInfo(h).combos;

interface Result {
  sol: IcmSolution;
  input: IcmInput;
  exploit: number;
  iterations: number;
  stopped: boolean;
}

export default function IcmPage() {
  const { t } = useSettings();
  const clientRef = useRef<IcmClient | null>(null);
  const [d, setD] = useState<Draft>(DEFAULT);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<IcmProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<{ player: number; facing: number | null }>({ player: 1, facing: null });
  const [selected, setSelected] = useState<number | null>(null);
  const [wasmOk, setWasmOk] = useState(true);
  const started = useRef(0);

  useEffect(() => {
    setWasmOk(typeof WebAssembly === "object");
    try {
      const raw = localStorage.getItem(DRAFT);
      if (raw) {
        const v = JSON.parse(raw) as Draft;
        if (v.n >= 2 && v.n <= 9 && v.stacks?.length === v.n) setD({ ...DEFAULT, ...v });
      }
    } catch {
      /* ignore */
    }
    setReady(true);
    return () => clientRef.current?.terminate();
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(DRAFT, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }, [ready, d]);

  const positions = POSITIONS[d.n];
  const payouts = useMemo(() => parsePayouts(d.payoutText), [d.payoutText]);
  const stacks = d.stacks.map((s) => Number(s));
  const stacksOk = stacks.length === d.n && stacks.every((s) => Number.isFinite(s) && s > 0);
  const canRun = wasmOk && !busy && !!payouts && stacksOk && Number(d.ante) >= 0 && Number(d.ante) < 5;
  const estSeconds = (ITERS[d.acc] * 0.07 * d.n * d.n) / 1000;

  const setN = (n: number) =>
    setD((p) => {
      const stacks = Array.from({ length: n }, (_, i) => p.stacks[i] ?? "20");
      return { ...p, n, stacks, hero: Math.min(p.hero, n - 1) };
    });
  const setPreset = (id: string) => {
    if (id === "custom") return setD((p) => ({ ...p, preset: "custom" }));
    const pr = PAYOUT_PRESETS.find((x) => x.id === id)!;
    setD((p) => ({ ...p, preset: id, payoutText: pr.payouts.join(", ") }));
  };

  const run = async () => {
    if (!canRun || !payouts) return;
    setError(null);
    setBusy(true);
    setProgress(null);
    setResult(null);
    setSelected(null);
    started.current = Date.now();
    const input: IcmInput = { stacks, sb: 0.5, bb: 1, ante: Number(d.ante) || 0, payouts };
    try {
      const c = (clientRef.current ??= new IcmClient());
      const r = await c.solve(input, { iterations: ITERS[d.acc], target: d.acc === "fast" ? 1.5 : d.acc === "std" ? 0.6 : 0.25, onProgress: setProgress });
      setResult({ sol: r.solution, input, exploit: r.exploit, iterations: r.iterations, stopped: r.cancelled });
      setView({ player: d.hero, facing: null });
    } catch (e) {
      setError(t("icm.error", { msg: String((e as Error)?.message ?? e) }));
    } finally {
      setBusy(false);
    }
  };

  const node = result?.sol.nodes.find((n) => n.player === view.player && n.facing === view.facing) ?? null;
  const cellValue = useMemo(() => {
    const v = new Float32Array(169);
    if (node) for (let h = 0; h < 169; h++) v[h] = node.weight[h] >= 0.02 ? node.freq[h] : 0;
    return v;
  }, [node]);
  const total = result ? result.input.stacks.reduce((a, b) => a + b, 0) : 0;
  const pos = result ? POSITIONS[result.sol.players] : positions;
  const facingChoices = result ? result.sol.nodes.filter((n) => n.player === view.player).sort((a, b) => (a.facing ?? -1) - (b.facing ?? -1)) : [];
  const chip = (on: boolean) => `min-h-10 rounded-full border px-3 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`;
  const input = "mt-1 block min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold">{t("icm.title")}</h1>
        <p className="text-sm text-muted">{t("icm.subtitle")}</p>
      </header>
      <SolveTabs />
      {!wasmOk && (
        <p role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">
          {t("icm.noWasm")}
        </p>
      )}

      <fieldset disabled={busy} className="min-w-0 space-y-5 border-0 p-0">
        <section className="space-y-2" aria-label={t("icm.quick")}>
          <h2 className="font-bold">{t("icm.quick")}</h2>
          <div className="flex flex-wrap gap-2">
            {(["ft9", "bubble", "hu"] as const).map((q) => (
              <button key={q} type="button" data-testid={`icm-quick-${q}`} onClick={() => setD(QUICK[q])} className="min-h-11 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold">
                {t(`icm.q.${q}` as Key)}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3" aria-label={t("icm.players")}>
          <h2 className="font-bold">{t("icm.players")}</h2>
          <div role="group" aria-label={t("icm.players")} className="grid grid-cols-8 gap-1 rounded-2xl bg-surface p-1">
            {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button key={n} type="button" aria-pressed={d.n === n} data-testid={`icm-n-${n}`} onClick={() => setN(n)} className={`min-h-11 rounded-xl text-sm font-bold ${d.n === n ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
                {n}
              </button>
            ))}
          </div>
          <h3 className="text-sm font-semibold text-muted">{t("icm.stacks")}</h3>
          <ul className="space-y-1.5" data-testid="icm-stacks">
            {positions.map((p, i) => (
              <li key={i} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
                <span className="font-bold">{p}</span>
                <input
                  aria-label={t("icm.stackOf", { pos: p })}
                  data-testid={`icm-stack-${i}`}
                  type="number"
                  inputMode="decimal"
                  min={0.5}
                  step={0.5}
                  value={d.stacks[i]}
                  onChange={(e) => setD((prev) => ({ ...prev, stacks: prev.stacks.map((s, k) => (k === i ? e.target.value : s)) }))}
                  className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-ink"
                />
                <button type="button" aria-pressed={d.hero === i} aria-label={t("icm.heroPick", { pos: p })} onClick={() => setD((prev) => ({ ...prev, hero: i }))} className={chip(d.hero === i)}>
                  {d.hero === i ? t("icm.hero") : "·"}
                </button>
              </li>
            ))}
          </ul>
          <label className="block text-sm text-muted">
            {t("icm.ante")}
            <input data-testid="icm-ante" type="number" inputMode="decimal" min={0} max={4} step={0.025} value={d.ante} onChange={(e) => setD((p) => ({ ...p, ante: e.target.value }))} className={input} />
          </label>
          <p className="text-xs text-muted">{t("icm.blinds")}</p>
        </section>

        <section className="space-y-2" aria-label={t("icm.payouts")}>
          <h2 className="font-bold">{t("icm.payouts")}</h2>
          <label className="block text-sm text-muted">
            <span className="sr-only">{t("icm.payouts")}</span>
            <select data-testid="icm-preset" value={d.preset} onChange={(e) => setPreset(e.target.value)} className={input}>
              {PAYOUT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`icm.p.${p.id}` as Key)}
                </option>
              ))}
              <option value="custom">{t("icm.p.custom")}</option>
            </select>
          </label>
          <label className="block text-sm text-muted">
            {t("icm.payoutText")}
            <input data-testid="icm-payouts" value={d.payoutText} onChange={(e) => setD((p) => ({ ...p, preset: "custom", payoutText: e.target.value }))} className={input} inputMode="decimal" />
          </label>
          {!payouts && (
            <p role="alert" className="text-sm text-[color:var(--g-blunder)]">
              {t("icm.payErr")}
            </p>
          )}
        </section>

        <section className="space-y-2" aria-label={t("icm.accuracy")}>
          <h2 className="font-bold">{t("icm.accuracy")}</h2>
          <div role="group" aria-label={t("icm.accuracy")} className="grid grid-cols-3 gap-1 rounded-2xl bg-surface p-1">
            {(["fast", "std", "high"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={d.acc === a} data-testid={`icm-acc-${a}`} onClick={() => setD((p) => ({ ...p, acc: a }))} className={`min-h-11 rounded-xl text-sm font-bold ${d.acc === a ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
                {t(`icm.acc.${a}` as Key)}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted">{t("solve.est", { s: estSeconds >= 90 ? t("solve.min", { n: Math.round(estSeconds / 60) }) : t("solve.sec", { n: Math.max(1, Math.round(estSeconds)) }) })}</p>
        </section>
      </fieldset>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label={t("icm.run")}>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button type="button" data-testid="icm-run" disabled={!canRun} onClick={run} className="min-h-14 rounded-2xl bg-accent text-lg font-extrabold text-accent-ink shadow disabled:opacity-50">
            {busy ? t("solve.running") : t("icm.run")}
          </button>
          {busy && (
            <button type="button" data-testid="icm-stop" onClick={() => clientRef.current?.cancel()} className="min-h-14 rounded-2xl border border-line px-5 font-bold">
              {t("icm.stop")}
            </button>
          )}
        </div>
        {busy && (
          <div role="status" aria-live="polite" data-testid="icm-progress">
            <div className="h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ? Math.round((100 * progress.done) / progress.total) : 0} aria-label={t("solve.running")}>
              <div className="h-full bg-accent transition-[width]" style={{ width: `${progress ? (100 * progress.done) / progress.total : 0}%` }} />
            </div>
            {progress && <p className="mt-1 text-sm text-muted">{t("icm.progress", { done: progress.done, total: progress.total, x: progress.exploit >= 0 ? progress.exploit.toFixed(2) : "…" })}</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-[color:var(--g-blunder)]">
            {error}
          </p>
        )}
      </section>

      {result && (
        <div className="space-y-5" data-testid="icm-result">
          <section className="space-y-2 rounded-2xl border border-line bg-surface p-4" aria-label={t("icm.equity")}>
            <h2 className="font-bold">{result.stopped ? t("icm.stopped") : t("icm.done")}</h2>
            <p className="text-sm text-muted" data-testid="icm-exploit">
              {t("icm.exploit", { x: result.exploit.toFixed(2) })} · {t("solve.iterCount", { n: result.iterations })}
            </p>
            <table className="w-full text-sm" data-testid="icm-equity">
              <caption className="sr-only">{t("icm.equity")}</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1 font-semibold">
                    {t("icm.eq.pos")}
                  </th>
                  <th scope="col" className="text-right font-semibold">
                    {t("icm.eq.stack")}
                  </th>
                  <th scope="col" className="text-right font-semibold">
                    {t("icm.eq.chips")}
                  </th>
                  <th scope="col" className="text-right font-semibold">
                    {t("icm.eq.icm")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.input.stacks.map((s, i) => (
                  <tr key={i} className={i === d.hero ? "font-extrabold" : ""}>
                    <th scope="row" className="py-1 text-left font-inherit">
                      {pos[i]}
                      {i === d.hero ? ` (${t("icm.hero")})` : ""}
                    </th>
                    <td className="text-right tabular-nums">{s}bb</td>
                    <td className="text-right tabular-nums">{((100 * s) / total).toFixed(1)}%</td>
                    <td className="text-right tabular-nums">{result.sol.startEquity[i].toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted">{t("icm.eq.hint")}</p>
          </section>

          <section className="space-y-3" aria-label={t("icm.ranges")}>
            <h2 className="font-bold">{t("icm.ranges")}</h2>
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label={t("icm.pickPlayer")}>
              {pos.map((p, i) =>
                i === result.sol.players - 1 ? null : (
                  <button key={i} type="button" aria-pressed={view.player === i} data-testid={`icm-view-${i}`} onClick={() => (setView({ player: i, facing: null }), setSelected(null))} className={`${chip(view.player === i)} whitespace-nowrap`}>
                    {p}
                    {i === d.hero ? " ★" : ""}
                  </button>
                ),
              )}
              {/* the big blind only ever responds */}
              <button type="button" aria-pressed={view.player === result.sol.players - 1} data-testid={`icm-view-${result.sol.players - 1}`} onClick={() => (setView({ player: result.sol.players - 1, facing: result.sol.nodes.find((n) => n.player === result.sol.players - 1 && n.facing !== null)?.facing ?? null }), setSelected(null))} className={`${chip(view.player === result.sol.players - 1)} whitespace-nowrap`}>
                BB{result.sol.players - 1 === d.hero ? " ★" : ""}
              </button>
            </div>
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label={t("icm.ranges")}>
              {facingChoices.map((n) => (
                <button key={String(n.facing)} type="button" aria-pressed={view.facing === n.facing} data-testid={`icm-facing-${n.facing ?? "open"}`} onClick={() => (setView({ player: n.player, facing: n.facing }), setSelected(null))} className={`${chip(view.facing === n.facing)} whitespace-nowrap`}>
                  {n.facing === null ? t("icm.open") : t("icm.vs", { pos: pos[n.facing] })}
                </button>
              ))}
            </div>
            {node && (
              <>
                <RangeCells value={cellValue} onSelect={(c) => setSelected(c)} selected={selected} ariaLabel={`${pos[node.player]}`} cellLabel={(name, w) => `${name}: ${Math.round(w * 100)}%`} />
                <p className="text-sm" data-testid="icm-range-info">
                  {t("icm.rangeInfo", {
                    pct: rangePercent(node, combos).toFixed(1),
                    act: node.facing === null ? t("icm.act.jam") : t("icm.act.call"),
                    combos: Math.round(Array.from(node.freq).reduce((s, f, h) => s + (node.weight[h] >= 0.02 ? f * combos(h) : 0), 0)),
                  })}
                  <span className="ml-2 text-xs text-muted">{t("icm.legend")}</span>
                </p>
                {selected !== null && (
                  <div className="rounded-2xl border border-line bg-surface p-3" data-testid="icm-hand">
                    <p className="text-xl font-extrabold">{classInfo(selected).name}</p>
                    {node.weight[selected] < 0.02 ? (
                      <p className="text-sm text-muted">{t("icm.notReached")}</p>
                    ) : (
                      <>
                        <p className="text-sm">{t("icm.handFreq", { act: node.facing === null ? t("icm.act.jam") : t("icm.act.call"), pct: Math.round(node.freq[selected] * 100) })}</p>
                        <p className="text-xs text-muted">{t("icm.handDetail", { evAct: node.evAct[selected].toFixed(2), evFold: node.evFold[selected].toFixed(2) })}</p>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            <p className="text-xs text-muted">{t("icm.note")}</p>
          </section>
        </div>
      )}
    </div>
  );
}
