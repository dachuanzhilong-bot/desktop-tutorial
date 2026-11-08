"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FreqBars } from "@/components/HandPanel";
import { PlayingCard } from "@/components/PlayingCard";
import { ActionLegend, GridAction, GridMode, RangeGrid } from "@/components/RangeGrid";
import { GridSkeleton, Skeleton } from "@/components/Skeleton";
import { StudyTabs } from "@/components/StudyTabs";
import { edgeTone, useEdgeText } from "@/components/postflop/edge";
import { Histogram } from "@/components/Charts";
import { Term } from "@/components/Term";
import { ALL_CLASSES, classInfo } from "@/lib/poker/hands";
import type { Key } from "@/lib/i18n/ja";
import { useSettings } from "@/lib/settings";
import { ActionKind } from "@/lib/solution/types";
import { toClassSolution, mixOf, rangeCombos } from "@/lib/postflop/aggregate";
import { CATEGORY_IDS, CategoryId, classify, matchesCategory } from "@/lib/postflop/categories";
import { COMBOS, COMBOS_OF_CLASS, NC, cardOf, cardText, comboCards } from "@/lib/postflop/combos";
import { dense, DenseNode, PfFlop, PfNode } from "@/lib/postflop/decode";
import { loadFlop, loadIndex, PfIndex } from "@/lib/postflop/loader";
import { contextAt, EdgeLabel, labelEdge, stepsTo } from "@/lib/postflop/replay";
import { fmtBB } from "@/lib/solution/tree";
import { haptic } from "@/lib/util/haptics";

const MODES: GridMode[] = ["strategy", "ev", "equity", "weight"];
const KIND_ACTION = [ActionKind.Fold, ActionKind.Call, ActionKind.Raise, ActionKind.AllIn];

function BoardCards({ board, size = "sm" }: { board: number[]; size?: "sm" | "tbl" }) {
  return (
    <div className="flex items-center gap-1.5" aria-label="board" role="group">
      {board.map((c, i) => (
        <span key={i} className={i === 3 || i === 4 ? "ml-1" : ""}>
          <PlayingCard card={cardOf(c)} size={size} />
        </span>
      ))}
    </div>
  );
}

function PostflopStudy() {
  const { t, settings } = useSettings();
  const edgeText = useEdgeText();
  const [index, setIndex] = useState<PfIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<string>("");
  const [flopIdx, setFlopIdx] = useState(0);
  const [flop, setFlop] = useState<PfFlop | null>(null);
  const [nodeId, setNodeId] = useState(0);
  const [mode, setMode] = useState<GridMode>("strategy");
  const [selected, setSelected] = useState<number | null>(null);
  const [category, setCategory] = useState<CategoryId>("all");
  const [blocker, setBlocker] = useState<number | null>(null);

  useEffect(() => {
    loadIndex()
      .then((ix) => {
        setIndex(ix);
        const p = new URLSearchParams(location.hash.replace(/^#/, ""));
        const s = p.get("s");
        setScenario(s && ix.scenarios.some((x) => x.id === s) ? s : ix.scenarios[0]?.id ?? "");
        setFlopIdx(Math.min(Number(p.get("f") ?? 0) || 0, ix.flops.length - 1));
        setNodeId(Number(p.get("n") ?? 0) || 0);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    if (!scenario) return;
    let alive = true;
    setFlop(null);
    loadFlop(scenario, flopIdx)
      .then((f) => alive && setFlop(f))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [scenario, flopIdx]);

  useEffect(() => {
    if (!scenario) return;
    try {
      history.replaceState(null, "", `${location.pathname}#s=${scenario}&f=${flopIdx}&n=${nodeId}`);
    } catch {
      /* ignore */
    }
  }, [scenario, flopIdx, nodeId]);

  const sc = index?.scenarios.find((s) => s.id === scenario);
  const node: PfNode | null = flop ? flop.nodes[Math.min(nodeId, flop.nodes.length - 1)] : null;
  const ctx = useMemo(() => (flop && node ? contextAt(flop, node.id) : null), [flop, node]);
  const steps = useMemo(() => (flop && node ? stepsTo(flop, node.id) : []), [flop, node]);
  const d: DenseNode | null = useMemo(() => (node ? dense(node) : null), [node]);
  const sol = useMemo(() => (node && d ? toClassSolution(node.id, d) : null), [node, d]);

  const labels: EdgeLabel[] = useMemo(() => (flop && node && node.type === "decision" ? node.edges.map((_, i) => labelEdge(flop, node.id, i)) : []), [flop, node]);
  const actions: GridAction[] = useMemo(() => labels.map((l, i) => ({ kind: KIND_ACTION[node?.edges[i].kind ?? 1], tone: edgeTone(l), label: edgeText(l) })), [labels, node, edgeText]);

  // hand categories per combo for the current board
  const info = useMemo(() => (ctx ? COMBOS.map((c) => (ctx.board.includes(c.c1) || ctx.board.includes(c.c2) ? null : classify(ctx.board, c.c1, c.c2))) : []), [ctx]);
  const gridFilter = useMemo(() => {
    if (category === "all" && blocker === null) return undefined;
    return (cls: number) =>
      COMBOS_OF_CLASS[cls].some((h) => {
        const inf = info[h];
        if (!inf || !d || d.weight[h] <= 0) return false;
        if (category !== "all" && !matchesCategory(inf, category)) return false;
        if (blocker !== null) {
          const [c1, c2] = [COMBOS[h].c1 >> 2, COMBOS[h].c2 >> 2];
          if (12 - c1 !== blocker && 12 - c2 !== blocker) return false;
        }
        return true;
      });
  }, [category, blocker, info, d]);

  const mix = useMemo(() => (d ? mixOf(d) : []), [d]);
  const eqBins = useMemo(() => {
    if (!d) return null;
    const bins = new Array(10).fill(0);
    let tot = 0;
    let acc = 0;
    for (let h = 0; h < NC; h++) {
      const w = d.weight[h];
      if (!w) continue;
      bins[Math.min(9, Math.floor(d.eq[h] * 10))] += w;
      tot += w;
      acc += w * d.eq[h];
    }
    return { bins, mean: tot ? acc / tot : 0 };
  }, [d]);

  const go = useCallback((id: number) => {
    haptic.tap();
    setNodeId(id);
    setSelected(null);
  }, []);

  if (error)
    return (
      <p role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">
        {t("pf.missing")} {error}
      </p>
    );
  if (!index || !sc)
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <GridSkeleton />
      </div>
    );

  const seatName = (a: number) => (a === 0 ? sc.oop : sc.ip);
  const nodeEnded = (code: number) => (code === -1 ? t("pf.end.fold") : code === -3 ? t("pf.end.showdown") : code === -4 ? t("pf.end.allin") : t("pf.end.pruned"));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">{t("study.title")}</h1>
        <p className="text-sm text-muted">{t("study.subtitle")}</p>
      </header>
      <StudyTabs />

      {/* scenario + flop */}
      <section className="space-y-2" aria-label={t("pf.scenario")}>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {index.scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === scenario}
              data-testid={`scenario-${s.id}`}
              onClick={() => {
                setScenario(s.id);
                setNodeId(0);
                setSelected(null);
              }}
              className={`min-h-10 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold ${s.id === scenario ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}
            >
              {s.title}
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="listbox" aria-label={t("pf.flop")}>
          {index.flops.map((f, i) => {
            const cards = f.split(" ");
            return (
              <button
                key={f}
                type="button"
                role="option"
                aria-selected={i === flopIdx}
                data-testid={`flop-${i}`}
                onClick={() => {
                  setFlopIdx(i);
                  setNodeId(0);
                  setSelected(null);
                }}
                className={`flex shrink-0 gap-0.5 rounded-xl border-2 p-1.5 ${i === flopIdx ? "border-accent bg-surface-2" : "border-transparent bg-surface"}`}
              >
                {cards.map((c) => (
                  <PlayingCard key={c} card={cardOf("23456789TJQKA".indexOf(c[0]) * 4 + "cdhs".indexOf(c[1]))} size="sm" />
                ))}
              </button>
            );
          })}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <Link href={`/practice/#mode=postSpot&scenario=${scenario}&flop=${flopIdx}`} data-testid="practice-this-flop" className="rounded-full border border-accent px-3 py-1.5 text-sm font-bold text-accent-text">
            {t("pf.practice")}
          </Link>
          <span>
          {sc.oop} {t("pf.oop")} {sc.oopPct.toFixed(0)}% · {sc.ip} {t("pf.ip")} {sc.ipPct.toFixed(0)}% · {t("pf.pot", { pot: fmtBB(sc.pot), stack: fmtBB(sc.stack) })}
          </span>
        </p>
      </section>

      {!flop || !node || !ctx ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <GridSkeleton />
        </div>
      ) : (
        <>
          {/* board + line */}
          <section className="rounded-2xl border border-line bg-surface p-3" aria-label={t("pf.board")}>
            <div className="flex items-center justify-between gap-3">
              <BoardCards board={ctx.board} size="tbl" />
              <div className="text-right text-sm">
                <p className="font-extrabold" data-testid="pf-pot">
                  {fmtBB(ctx.pot)} <span className="text-xs font-semibold text-muted">bb</span>
                </p>
                <p className="text-xs text-muted">{t(`pf.street.${node.street}` as Key)}</p>
              </div>
            </div>
            <ol className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5" aria-label={t("study.line")}>
              <li>
                <button type="button" onClick={() => go(0)} className="min-h-9 whitespace-nowrap rounded-full border border-line px-3 text-sm font-semibold text-muted">
                  {t("study.root")}
                </button>
              </li>
              {steps.map((s, i) => {
                const isCard = s.node.type === "chance";
                const lab = !isCard ? labelEdge(flop, s.node.id, s.edgeIndex) : null;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => go(flop.nodes[s.node.id].id)}
                      className={`${isCard ? "border border-line bg-surface-2" : "seg"} flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-bold ${isCard ? "text-ink" : "text-white"}`}
                      data-k={lab ? edgeTone(lab) : undefined}
                    >
                      {isCard ? <span>{cardText(s.edge.kind)}</span> : <><span>{seatName(s.node.actor)}</span><span className="opacity-90">{edgeText(lab!)}</span></>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* next step */}
          {node.type === "chance" ? (
            <section aria-label={t("pf.deal")} className="space-y-2">
              <h2 className="text-sm font-bold text-muted">{t("pf.deal")}</h2>
              <p className="text-xs text-muted">{t("pf.dealHint")}</p>
              <div className="flex flex-wrap gap-2">
                {node.edges.map((e, i) => (
                  <button key={i} type="button" disabled={e.code < 0} data-testid="deal-card" onClick={() => e.code >= 0 && go(e.code)} className="rounded-xl border border-line bg-surface p-1.5 disabled:opacity-40" aria-label={cardText(e.kind)}>
                    <PlayingCard card={cardOf(e.kind)} size="tbl" />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section aria-label={t("study.next")} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="text-sm font-bold text-muted" data-testid="pf-actor">
                  {seatName(node.actor)} · {t(node.actor === 0 ? "pf.oop" : "pf.ip")}
                  {ctx.toCall > 0 ? ` · ${t("pf.toCall", { n: fmtBB(ctx.toCall) })}` : ""}
                </h2>
                <span className="text-xs text-muted">
                  {t("study.reach")} {(node.reach * 100).toFixed(node.reach < 0.01 ? 2 : 1)}%
                </span>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${node.edges.length}, minmax(0, 1fr))` }}>
                {node.edges.map((e, i) => {
                  const can = e.code >= 0;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!can}
                      data-testid={`pf-next-${e.kind}`}
                      onClick={() => can && go(e.code)}
                      className="seg flex min-h-14 flex-col items-center justify-center rounded-2xl px-1 py-1.5 text-white shadow transition-transform active:scale-[0.97] disabled:opacity-60"
                      data-k={actions[i]?.tone}
                    >
                      <span className="text-sm font-extrabold">{actions[i]?.label}</span>
                      <span className="text-xs font-semibold opacity-95">{mix[i] !== undefined ? `${(mix[i] * 100).toFixed(1)}%` : "…"}</span>
                      {!can && <span className="text-[0.62rem] opacity-90">{nodeEnded(e.code)}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {node.type === "decision" && sol && d && (
            <>
              <div role="tablist" aria-label={t("study.modeLabel")} className="grid grid-cols-4 gap-1 rounded-2xl bg-surface p-1">
                {MODES.map((md) => (
                  <button key={md} role="tab" type="button" aria-selected={mode === md} onClick={() => setMode(md)} className={`min-h-11 rounded-xl text-sm font-bold ${mode === md ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
                    {t(`study.mode.${md}` as Key)}
                  </button>
                ))}
              </div>
              <RangeGrid sol={sol} actions={actions} mode={mode} selected={selected} onSelect={(c) => { haptic.tap(); setSelected(c); }} filter={gridFilter} showNumbers={settings.labels} ariaLabel={`${seatName(node.actor)}`} />
              <div className="flex items-center justify-between gap-3">
                <ActionLegend actions={actions} />
                <span className="text-xs text-muted">{t("pf.exploit", { n: (index.stats[`${scenario}/${flopIdx}`]?.exploit ?? 0).toFixed(1) })}</span>
              </div>

              {selected !== null ? <ComboPanel cls={selected} d={d} actions={actions} board={ctx.board} /> : <p className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">{t("study.selectHand")}</p>}

              <section className="rounded-2xl border border-line bg-surface p-4" aria-label={t("study.actionMix")}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="font-bold">
                    <Term id="range">{t("study.rangeWidth")}</Term>
                  </h3>
                  <span className="text-lg font-extrabold" data-testid="pf-combos">
                    {rangeCombos(d).toFixed(0)} {t("common.combos")}
                  </span>
                </div>
                <div className="flex h-4 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={t("study.actionMix")}>
                  {actions.map((a, i) => (
                    <span key={i} className="seg block h-full" data-k={a.tone} style={{ width: `${(mix[i] ?? 0) * 100}%` }} />
                  ))}
                </div>
                <ul className="mt-2 grid gap-2 text-center text-sm" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
                  {actions.map((a, i) => (
                    <li key={i} className="rounded-xl bg-surface-2 py-1.5">
                      <div className="text-xs text-muted">{a.label}</div>
                      <div className="font-extrabold">{((mix[i] ?? 0) * 100).toFixed(1)}%</div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-2" aria-label={t("pf.category")}>
                <h3 className="text-sm font-bold text-muted">{t("pf.category")}</h3>
                <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
                  {CATEGORY_IDS.map((c) => (
                    <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={`min-h-9 whitespace-nowrap rounded-full border px-3 text-sm font-semibold ${category === c ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}>
                      {t(`pf.cat.${c}` as Key)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  <span className="shrink-0 text-sm text-muted">
                    <Term id="blocker">{t("study.blockers")}</Term>
                  </span>
                  {[0, 1, 2, 3, 4].map((r) => (
                    <button key={r} type="button" aria-pressed={blocker === r} aria-label={"AKQJT"[r]} onClick={() => setBlocker(blocker === r ? null : r)} className={`grid min-h-9 min-w-9 place-items-center rounded-full border text-sm font-bold ${blocker === r ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}>
                      {"AKQJT"[r]}
                    </button>
                  ))}
                </div>
              </section>

              {eqBins && (
                <section className="rounded-2xl border border-line bg-surface p-4">
                  <h3 className="mb-1 font-bold">{t("study.eqDist")}</h3>
                  <p className="mb-1 text-xs text-muted">{t("study.eqDistHint")}</p>
                  <Histogram bins={eqBins.bins} labels={eqBins.bins.map((_, i) => `${i * 10}`)} label={t("study.eqDist")} />
                  <p className="mt-1 text-sm">
                    {t("study.avgEq")}: <b>{(eqBins.mean * 100).toFixed(1)}%</b>
                  </p>
                </section>
              )}
            </>
          )}
          <p className="text-center text-xs text-muted">{t("pf.approx")}</p>
        </>
      )}
    </div>
  );
}

/** per-suit breakdown of the selected chart cell */
function ComboPanel({ cls, d, actions, board }: { cls: number; d: DenseNode; actions: GridAction[]; board: number[] }) {
  const { t } = useSettings();
  const list = COMBOS_OF_CLASS[cls].filter((h) => !board.includes(COMBOS[h].c1) && !board.includes(COMBOS[h].c2));
  const present = list.filter((h) => d.weight[h] > 0);
  const first = present[0] ?? list[0];
  const inf = first !== undefined ? classify(board, COMBOS[first].c1, COMBOS[first].c2) : null;
  return (
    <section aria-label={t("study.hand")} className="rounded-2xl border border-line bg-surface p-4" data-testid="pf-hand-panel">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-2xl font-extrabold">{classInfo(cls).name}</h3>
        <span className="text-sm text-muted">
          {present.length}/{list.length} {t("common.combos")}
        </span>
      </div>
      {inf && (
        <p className="mb-2 text-sm text-muted">
          {t(`pf.made.${inf.made}` as Key)}
          {inf.flushDraw ? ` · ${t("pf.draw.fd")}` : ""}
          {inf.oesd ? ` · ${t("pf.draw.oesd")}` : inf.gutshot ? ` · ${t("pf.draw.gs")}` : ""}
        </p>
      )}
      <p className="mb-2 text-xs text-muted">{t("pf.comboHint")}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-1 font-semibold" scope="col">
                {t("pf.combos")}
              </th>
              <th className="pb-1 text-right font-semibold" scope="col">
                {t("study.weight")}
              </th>
              {actions.map((a, i) => (
                <th key={i} className="pb-1 text-right font-semibold" scope="col">
                  {a.label}
                </th>
              ))}
              <th className="pb-1 text-right font-semibold" scope="col">
                {t("study.equity")}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((h) => {
              const [c1, c2] = comboCards(h);
              const w = d.weight[h];
              return (
                <tr key={h} className={w > 0 ? "" : "opacity-45"}>
                  <th scope="row" className="py-1">
                    <span className="inline-flex gap-0.5">
                      <PlayingCard card={c1} size="sm" />
                      <PlayingCard card={c2} size="sm" />
                    </span>
                  </th>
                  <td className="text-right tabular-nums">{Math.round(w * 100)}%</td>
                  {actions.map((_, a) => (
                    <td key={a} className="text-right tabular-nums">
                      <b>{w > 0 ? Math.round(d.freq[a * NC + h] * 100) : "–"}</b>
                      {w > 0 && <span className="ml-1 text-xs text-muted">{d.ev[a * NC + h].toFixed(1)}</span>}
                    </td>
                  ))}
                  <td className="text-right tabular-nums">{w > 0 ? `${(d.eq[h] * 100).toFixed(0)}%` : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function PostflopStudyPage() {
  return <PostflopStudy />;
}
