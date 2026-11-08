"use client";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { HandPanel, FreqBars } from "@/components/HandPanel";
import { LineBar } from "@/components/LineBar";
import { StudyTabs } from "@/components/StudyTabs";
import { ActionLegend, GridAction, RangeGrid, GridMode, toneFor } from "@/components/RangeGrid";
import { SolutionGate } from "@/components/SolutionGate";
import { GridSkeleton } from "@/components/Skeleton";
import { Histogram } from "@/components/Charts";
import { Term } from "@/components/Term";
import { ALL_CLASSES, HAND_FILTERS, HandFilterId, holdsRank, matchesFilter, RANK_CHARS } from "@/lib/poker/hands";
import { useSettings } from "@/lib/settings";
import type { SolutionStore } from "@/lib/solution/loader";
import { useNodeSolution } from "@/lib/solution/context";
import { actionLabel, fmtBB, history, spotType, stateAt } from "@/lib/solution/tree";
import { ActionKind, Terminal } from "@/lib/solution/types";
import type { Key } from "@/lib/i18n/ja";
import { actionCombos, actionMix, actionRange, equityBins, rangeCombosOf, rangeWidth } from "@/lib/study/summary";
import { haptic } from "@/lib/util/haptics";

const MODES: GridMode[] = ["strategy", "ev", "equity", "weight"];

function termKey(term: Terminal): Key {
  return term === Terminal.Fold ? "term.fold" : term === Terminal.Flop ? "term.flop" : term === Terminal.FlopMulti ? "term.flopMulti" : "term.allin";
}

function replaceHash(id: number) {
  try {
    window.history.replaceState(null, "", `${location.pathname}#n=${id}`);
  } catch {
    /* ignore */
  }
}

function Study({ store }: { store: SolutionStore }) {
  const { t, settings } = useSettings();
  const m = store.manifest;
  const [nodeId, setNodeId] = useState(0);
  const [mode, setMode] = useState<GridMode>("strategy");
  // the tab highlight updates at once; the 169 cells follow in the background (keeps taps under ~100 ms on slow phones)
  const gridMode = useDeferredValue(mode);
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<HandFilterId>("all");
  const [blocker, setBlocker] = useState<number | null>(null);
  const [peek, setPeek] = useState<number | null>(null);
  const [tab, setTab] = useState<"range" | "compare">("range");

  // deep link: #n=123
  useEffect(() => {
    const m1 = /n=(\d+)/.exec(location.hash);
    if (m1 && Number(m1[1]) < m.nodes.length) setNodeId(Number(m1[1]));
  }, [m.nodes.length]);
  useEffect(() => replaceHash(nodeId), [nodeId]);

  const node = m.nodes[nodeId];
  const state = useMemo(() => stateAt(m, nodeId), [m, nodeId]);
  const steps = useMemo(() => history(m, nodeId), [m, nodeId]);
  const { sol, loading, error } = useNodeSolution(nodeId);

  const actions: GridAction[] = useMemo(
    () => node.actions.map((a) => ({ kind: a.kind, tone: toneFor(a.kind, state.level), label: actionLabel(a, node.actor, state, t) })),
    [node, state, t],
  );

  const go = useCallback((id: number) => {
    haptic.tap();
    setNodeId(id);
    setSelected(null);
    setPeek(null);
  }, []);

  const mix = useMemo(() => (sol ? actionMix(sol) : []), [sol]);
  const combos = useMemo(() => (sol ? actionCombos(sol) : []), [sol]);
  const eq = useMemo(() => (sol ? equityBins(sol) : null), [sol]);

  const gridFilter = useMemo(() => {
    if (filter === "all" && blocker === null) return undefined;
    return (h: number) => matchesFilter(h, filter) && (blocker === null || holdsRank(h, blocker));
  }, [filter, blocker]);

  // the raiser's range for the comparison tab
  const agg = state.lastRaiser;
  const aggStep = useMemo(() => [...steps].reverse().find((s) => s.actor === agg && (s.action.kind === ActionKind.Raise || s.action.kind === ActionKind.AllIn)), [steps, agg]);
  const { sol: aggSol } = useNodeSolution(tab === "compare" && aggStep ? aggStep.node.id : null);
  const aggRange = useMemo(() => (aggSol && aggStep ? actionRange(aggSol, aggStep.actionIndex) : null), [aggSol, aggStep]);

  const peekLongPress = useCallback((cls: number) => {
    haptic.good();
    setPeek(cls);
    setSelected(cls);
    window.setTimeout(() => setPeek((p) => (p === cls ? null : p)), 2600);
  }, []);

  const spot = spotType(m, nodeId);
  const toCall = Math.max(0, state.cur - state.inv[node.actor]);
  const info = m.info as { iterations?: number; polish?: number };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">{t("study.title")}</h1>
        <p className="text-sm text-muted" data-testid="study-sub">
          {t("format.cash6")} · {t("format.stack", { n: m.stack })} · {t(`spot.${spot}` as Key)}
        </p>
      </header>
      <StudyTabs />

      <LineBar steps={steps} players={m.players} currentLabel={`${m.players[node.actor]} ?`} onJump={go} />

      {/* next actions */}
      <section aria-label={t("study.next")} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-sm font-bold text-muted" data-testid="study-pot">
            {m.players[node.actor]} · {t("study.potInfo", { pot: fmtBB(state.pot), call: fmtBB(toCall) })}
          </h2>
          <span className="text-xs text-muted">
            {t("study.reach")} {(node.reach * 100).toFixed(node.reach < 0.01 ? 2 : 1)}%
          </span>
        </div>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${node.actions.length}, minmax(0, 1fr))` }}>
          {node.actions.map((a, i) => {
            const pct = mix[i] !== undefined ? Math.round(mix[i] * 1000) / 10 : null;
            const can = a.child >= 0;
            return (
              <button
                key={i}
                type="button"
                disabled={!can}
                data-testid={`next-${a.kind}`}
                onClick={() => can && go(a.child)}
                title={a.child === -2 ? t("term.pruned") : a.term !== Terminal.None ? t(termKey(a.term)) : undefined}
                className="seg flex min-h-14 flex-col items-center justify-center rounded-2xl px-1 py-1.5 text-white shadow transition-transform active:scale-[0.97] disabled:opacity-60"
                data-k={actions[i].tone}
              >
                <span className="text-sm font-extrabold">
                  {actions[i].label}
                  {a.kind !== ActionKind.Fold && a.to > 0 ? ` ${fmtBB(a.to)}` : ""}
                </span>
                <span className="text-xs font-semibold opacity-95">{pct === null ? "…" : `${pct}%`}</span>
                {!can && <span className="text-[0.62rem] opacity-90">{a.child === -2 ? "—" : t(termKey(a.term))}</span>}
              </button>
            );
          })}
        </div>
      </section>

      {/* mode tabs */}
      <div role="tablist" aria-label={t("study.modeLabel")} className="grid grid-cols-4 gap-1 rounded-2xl bg-surface p-1">
        {MODES.map((md) => (
          <button
            key={md}
            role="tab"
            type="button"
            aria-selected={mode === md}
            onClick={() => setMode(md)}
            className={`min-h-11 rounded-xl text-sm font-bold transition-colors ${mode === md ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            {t(`study.mode.${md}` as Key)}
          </button>
        ))}
      </div>

      {/* chart */}
      <div className="relative">
        {error ? (
          <p role="alert" className="rounded-xl border border-line p-4 text-sm">
            {t("study.noData")}: {error}
          </p>
        ) : !sol ? (
          <GridSkeleton />
        ) : (
          <RangeGrid
            sol={sol}
            actions={actions}
            mode={gridMode}
            selected={selected}
            onSelect={(c) => {
              haptic.tap();
              setSelected(c);
            }}
            onLongPress={(c) => peekLongPress(c)}
            filter={gridFilter}
            showNumbers={settings.labels}
            ariaLabel={`${m.players[node.actor]} ${t("study.mode.strategy")}`}
          />
        )}
        {sol && peek !== null && (
          <div role="status" className="absolute inset-x-2 top-2 z-10 rounded-2xl border border-line bg-surface/95 p-3 shadow-xl backdrop-blur">
            <p className="mb-1 text-sm font-extrabold">{ALL_CLASSES[peek].name}</p>
            <FreqBars sol={sol} h={peek} actions={actions} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <ActionLegend actions={actions} />
        <span className="text-xs text-muted">{t("study.longPress")}</span>
      </div>

      {/* hand details */}
      {sol && selected !== null ? (
        <HandPanel sol={sol} h={selected} actions={actions} />
      ) : (
        <p className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">{t("study.selectHand")}</p>
      )}

      {/* summary */}
      {sol && (
        <section className="rounded-2xl border border-line bg-surface p-4" aria-label={t("study.actionMix")}>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="font-bold">
              <Term id="range">{t("study.rangeWidth")}</Term>
            </h3>
            <span className="text-lg font-extrabold" data-testid="range-width">
              {(rangeWidth(sol) * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex h-4 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={t("study.actionMix")}>
            {actions.map((a, i) => (
              <span key={i} className="seg block h-full" data-k={a.tone} style={{ width: `${mix[i] * 100}%` }} />
            ))}
          </div>
          <ul className="mt-2 grid gap-2 text-center text-sm" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
            {actions.map((a, i) => (
              <li key={i} className="rounded-xl bg-surface-2 py-1.5">
                <div className="text-xs text-muted">{a.label}</div>
                <div className="font-extrabold">{(mix[i] * 100).toFixed(1)}%</div>
                <div className="text-xs text-muted">
                  {combos[i].toFixed(0)} {t("common.combos")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* filters */}
      <section className="space-y-2" aria-label={t("study.filter")}>
        <h3 className="text-sm font-bold text-muted">{t("study.filter")}</h3>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {HAND_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-9 whitespace-nowrap rounded-full border px-3 text-sm font-semibold ${filter === f ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}
            >
              {t(`hf.${f}` as Key)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="shrink-0 text-sm text-muted">
            <Term id="blocker">{t("study.blockers")}</Term>
          </span>
          {[0, 1, 2, 3, 4].map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={blocker === r}
              aria-label={`${RANK_CHARS[r]}`}
              onClick={() => setBlocker(blocker === r ? null : r)}
              className={`grid min-h-9 min-w-9 place-items-center rounded-full border text-sm font-bold ${blocker === r ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}
            >
              {RANK_CHARS[r]}
            </button>
          ))}
        </div>
      </section>

      {/* equity distribution + range comparison */}
      {sol && (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label={t("study.compare")}>
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            <button role="tab" type="button" aria-selected={tab === "range"} onClick={() => setTab("range")} className={`min-h-10 rounded-lg text-sm font-bold ${tab === "range" ? "bg-accent text-accent-ink" : "text-muted"}`}>
              {t("study.eqDist")}
            </button>
            <button role="tab" type="button" aria-selected={tab === "compare"} onClick={() => setTab("compare")} className={`min-h-10 rounded-lg text-sm font-bold ${tab === "compare" ? "bg-accent text-accent-ink" : "text-muted"}`}>
              {t("study.compare")}
            </button>
          </div>
          {tab === "range" && eq && (
            <div>
              <p className="mb-1 text-xs text-muted">{t("study.eqDistHint")}</p>
              <Histogram bins={eq.bins} labels={eq.bins.map((_, i) => `${i * 10}`)} label={t("study.eqDist")} />
              <p className="mt-1 text-sm">
                {t("study.avgEq")}: <b>{(eq.mean * 100).toFixed(1)}%</b>
              </p>
            </div>
          )}
          {tab === "compare" && (
            <div>
              <p className="mb-2 text-xs text-muted">{t("study.compareHint")}</p>
              <div className="grid grid-cols-2 gap-3">
                <MiniRange title={`${t("study.actor")} · ${m.players[node.actor]}`} range={sol.weight} combos={rangeCombosOf(sol.weight)} tone="call" />
                {aggRange && aggStep ? (
                  <MiniRange title={`${t("study.aggressor")} · ${m.players[aggStep.actor]}`} range={aggRange} combos={rangeCombosOf(aggRange)} tone="raise1" />
                ) : (
                  <p className="grid place-items-center rounded-xl border border-dashed border-line p-3 text-center text-xs text-muted">—</p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <p className="text-center text-xs text-muted">
        {t("study.approx")}
        {info.iterations ? ` · ${info.iterations + (info.polish ?? 0)} it.` : ""}
      </p>
      {loading && (
        <span className="sr-only-live" role="status">
          {t("common.loading")}
        </span>
      )}
    </div>
  );
}

function MiniRange({ title, range, combos, tone }: { title: string; range: ArrayLike<number>; combos: number; tone: "call" | "raise1" }) {
  return (
    <figure>
      <figcaption className="mb-1 text-xs font-bold">
        {title}
        <span className="ml-1 font-normal text-muted">{((combos / 1326) * 100).toFixed(1)}%</span>
      </figcaption>
      <div className="grid13" style={{ gap: 1 }} role="img" aria-label={`${title} ${((combos / 1326) * 100).toFixed(1)}%`}>
        {ALL_CLASSES.map((c) => {
          const w = range[c.id];
          return (
            <span key={c.id} className="relative aspect-square overflow-hidden rounded-[2px] bg-[var(--cell-empty)]">
              {w > 0.01 && <span className="seg absolute inset-x-0 bottom-0" data-k={tone} style={{ height: `${Math.min(1, w) * 100}%` }} />}
            </span>
          );
        })}
      </div>
    </figure>
  );
}

export default function StudyPage() {
  return <SolutionGate>{(store) => <Study store={store} />}</SolutionGate>;
}
