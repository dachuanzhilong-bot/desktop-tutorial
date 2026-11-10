"use client";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { HandPanel, FreqBars } from "@/components/HandPanel";
import { LineBar } from "@/components/LineBar";
import { DepthPicker } from "@/components/DepthPicker";
import { StudyTabs } from "@/components/StudyTabs";
import { ActionLegend, GridAction, RangeGrid, GridMode, toneFor } from "@/components/RangeGrid";
import { SolutionGate } from "@/components/SolutionGate";
import { GridSkeleton } from "@/components/Skeleton";
import { Histogram } from "@/components/Charts";
import { Term } from "@/components/Term";
import { ALL_CLASSES, classInfo, HAND_FILTERS, HandFilterId, holdsRank, matchesFilter, RANK_CHARS } from "@/lib/poker/hands";
import { useSettings } from "@/lib/settings";
import { useLatest } from "@/lib/util/hooks";
import { preload } from "react-dom";
import { ApproxNote } from "@/components/ApproxNote";
import type { SolutionStore } from "@/lib/solution/loader";
import { useNodeSolution, useSolutionStore } from "@/lib/solution/context";
import { DEPTHS } from "@/lib/solution/loader";
import { actionLabel, fmtBB, history, lineText, spotType, stateAt } from "@/lib/solution/tree";
import { ActionKind, Terminal } from "@/lib/solution/types";
import type { Key } from "@/lib/i18n/ja";
import { actionCombos, actionMix, actionRange, equityBins, rangeCombosOf, rangeWidth } from "@/lib/study/summary";
import { haptic } from "@/lib/util/haptics";
import { preflopHash, preflopLink } from "@/lib/study/links";
import { SaveButton } from "@/components/SaveButton";
import { withBase } from "@/lib/util/base";

const MODES: GridMode[] = ["strategy", "ev", "equity", "weight"];

function termKey(term: Terminal): Key {
  return term === Terminal.Fold ? "term.fold" : term === Terminal.Flop ? "term.flop" : term === Terminal.FlopMulti ? "term.flopMulti" : "term.allin";
}

function replaceHash(id: number, depth: number, hand: number | null) {
  try {
    window.history.replaceState(null, "", `${location.pathname}${preflopHash(depth, id, hand)}`);
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

  // deep link: #d=40&n=123 (depth, node). Another depth starts at the node given, or at the root, once that solution has loaded.
  const { depth, setDepth } = useSolutionStore();
  const depthRef = useLatest(depth);
  const wanted = useRef<{ d: number | null; n: number | null; h: number | null } | null>(null);
  /** the address this view last applied or wrote: when the address is something else, a change from outside is on its way */
  const known = useRef("");
  const nodeCount = useLatest(m.nodes.length);
  useEffect(() => {
    const apply = () => {
      known.current = location.hash;
      const d = /d=(\d+)/.exec(location.hash);
      const n = /n=(\d+)/.exec(location.hash);
      const h = /h=(\d+)/.exec(location.hash); // the hand class to open on the chart (0..168)
      const want = { d: d ? Number(d[1]) : null, n: n ? Number(n[1]) : null, h: h && Number(h[1]) < 169 ? Number(h[1]) : null };
      if (want.d !== null && (DEPTHS as readonly number[]).includes(want.d) && want.d !== depthRef.current) {
        wanted.current = want; // applied when the other solution is here
        setDepth(want.d);
      } else {
        if (want.n !== null && want.n < nodeCount.current) setNodeId(want.n);
        if (want.h !== null) setSelected(want.h);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shownId = useRef<string | null>(null);
  useEffect(() => {
    const first = shownId.current === null;
    shownId.current = m.id;
    const w = wanted.current;
    if (w && (w.d === null || w.d === m.stack)) {
      wanted.current = null;
      setNodeId(w.n !== null && w.n < m.nodes.length ? w.n : 0);
      setSelected(w.h);
    } else if (!first) {
      setNodeId(0);
      setSelected(null);
      setBlocker(null);
    }
  }, [m.id, m.stack, m.nodes.length]);
  // keep the deep link in the URL once the user moves (Next mirrors history.replaceState into its router state, so a
  // write right after load could cancel a navigation the user has already started: the default view writes nothing)
  const firstView = useRef(true);
  useEffect(() => {
    const first = firstView.current;
    firstView.current = false;
    // the first view never rewrites the address it was opened with: the link is applied by the effect above, and the
    // address follows once the view has moved
    const want = preflopHash(m.stack, nodeId, selected);
    if (first || location.hash === want) return;
    // the address was changed from outside (a link, the back button) and its hashchange has not been handled yet:
    // writing now would undo that change
    if (location.hash !== known.current) return;
    replaceHash(nodeId, m.stack, selected);
    known.current = want;
  }, [nodeId, m.stack, selected]);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" data-testid="study-sub">
          {t("format.cash6")} · {t("format.stack", { n: m.stack })} · {t(`spot.${spot}` as Key)}
        </p>
        <SaveButton
          href={preflopLink(m.stack, nodeId, selected)}
          title={`${m.stack}bb · ${m.players[node.actor]}${steps.length ? ` · ${lineText(m, nodeId, t)}` : ""}${selected === null ? "" : ` · ${classInfo(selected).name}`}`}
        />
      </div>

      <LineBar steps={steps} players={m.players} currentLabel={`${m.players[node.actor]} ?`} onJump={go} />

      {/* wide screens: chart on the left, details on the right */}
      <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] lg:items-start lg:gap-6 lg:space-y-0">
      <div className="space-y-4">
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
                className="seg flex min-h-cta flex-col items-center justify-center rounded-card px-1 py-1.5 text-white shadow transition-transform active:scale-[0.97] disabled:opacity-60"
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
      <div role="tablist" aria-label={t("study.modeLabel")} className="grid grid-cols-4 gap-1 rounded-card bg-surface p-1">
        {MODES.map((md) => (
          <button
            key={md}
            role="tab"
            type="button"
            aria-selected={mode === md}
            onClick={() => setMode(md)}
            className={`min-h-tap rounded-control text-sm font-bold transition-colors ${mode === md ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            {t(`study.mode.${md}` as Key)}
          </button>
        ))}
      </div>

      {/* chart */}
      <div className="relative">
        {error ? (
          <p role="alert" className="rounded-control border border-line p-4 text-sm">
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
          <div role="status" className="absolute inset-x-2 top-2 z-10 rounded-card border border-line bg-surface/95 p-3 shadow-xl backdrop-blur">
            <p className="mb-1 text-sm font-extrabold">{ALL_CLASSES[peek].name}</p>
            <FreqBars sol={sol} h={peek} actions={actions} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <ActionLegend actions={actions} />
        <span className="text-xs text-muted">{t("study.longPress")}</span>
      </div>

      </div>
      <div className="space-y-4 lg:sticky lg:top-4">
      {/* hand details */}
      {sol && selected !== null ? (
        <HandPanel sol={sol} h={selected} actions={actions} />
      ) : (
        <p className="rounded-card border border-dashed border-line p-4 text-center text-sm text-muted">{t("study.selectHand")}</p>
      )}

      {/* summary */}
      {sol && (
        <section className="rounded-card border border-line bg-surface p-4" aria-label={t("study.actionMix")}>
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
              <li key={i} className="rounded-control bg-surface-2 py-1.5">
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
              className={`min-h-tap whitespace-nowrap rounded-full border px-3 text-sm font-semibold ${filter === f ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}
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
              className={`grid min-h-tap min-w-tap place-items-center rounded-full border text-sm font-bold ${blocker === r ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}
            >
              {RANK_CHARS[r]}
            </button>
          ))}
        </div>
      </section>

      {/* equity distribution + range comparison */}
      {sol && (
        <section className="space-y-3 rounded-card border border-line bg-surface p-4" aria-label={t("study.compare")}>
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-control bg-surface-2 p-1">
            <button role="tab" type="button" aria-selected={tab === "range"} onClick={() => setTab("range")} className={`min-h-tap rounded-control text-sm font-bold ${tab === "range" ? "bg-accent text-accent-ink" : "text-muted"}`}>
              {t("study.eqDist")}
            </button>
            <button role="tab" type="button" aria-selected={tab === "compare"} onClick={() => setTab("compare")} className={`min-h-tap rounded-control text-sm font-bold ${tab === "compare" ? "bg-accent text-accent-ink" : "text-muted"}`}>
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
                  <p className="grid place-items-center rounded-control border border-dashed border-line p-3 text-center text-xs text-muted">—</p>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      </div>
      </div>
      <ApproxNote>{t(m.stack === 100 ? "approx.preflop" : "approx.preflopRough", { depth: m.stack, iters: Number(info.iterations ?? 0) + Number(info.polish ?? 0) })}</ApproxNote>
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

/** the page frame is static HTML (painted at once); the chart part waits for the solution data */
export default function StudyPage() {
  const { t } = useSettings();
  // the default (100bb) solution starts downloading from the static HTML; other depths load when chosen
  preload(withBase("/solutions/cash6max-100bb/manifest.json.gz"), { as: "fetch", crossOrigin: "anonymous" });
  preload(withBase("/solutions/cash6max-100bb/chunk-0.bin.gz"), { as: "fetch", crossOrigin: "anonymous" });
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">{t("study.title")}</h1>
      </header>
      <StudyTabs />
      <DepthPicker />
      <SolutionGate>{(store) => <Study store={store} />}</SolutionGate>
    </div>
  );
}
