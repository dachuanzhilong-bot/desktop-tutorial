"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import { SolutionGate } from "@/components/SolutionGate";
import { ReviewTabs } from "@/components/analyze/ReviewTabs";
import { GradeBadge } from "@/components/practice/ResultPanel";
import { analyzeHand, effectiveStack, MAX_STACK, MIN_STACK } from "@/lib/analyze/match";
import type { DecisionInfo } from "@/lib/analyze/match";
import { filterHands, HandFilter, mistakeSolution, practiceItems, solutionOf, summarize, weakSpots } from "@/lib/analyze/aggregate";
import { normalizeHand, SEAT_NAMES } from "@/lib/analyze/normalize";
import { parseHandHistory } from "@/lib/analyze/parse";
import type { Key } from "@/lib/i18n/ja";
import { cardOf } from "@/lib/postflop/combos";
import { saveDraft } from "@/lib/solve/draft";
import { depthOf, nearestDepth } from "@/lib/solution/loader";
import type { SolutionStore } from "@/lib/solution/loader";
import { useSolutionStore } from "@/lib/solution/context";
import { actionLabel, fmtBB, stateAt } from "@/lib/solution/tree";
import { ActionKind } from "@/lib/solution/types";
import type { Manifest, SpotType } from "@/lib/solution/types";
import { useSettings } from "@/lib/settings";
import { getRepo } from "@/lib/storage/idb";
import type { StoredHand } from "@/lib/storage/types";

interface Report {
  total: number;
  added: number;
  dup: number;
  skipped: Record<string, number>;
}

const PAGE = 15;

export default function AnalyzePage() {
  return <SolutionGate grid={false}>{(store) => <Analyze store={store} />}</SolutionGate>;
}

function Analyze({ store }: { store: SolutionStore }) {
  const { t } = useSettings();
  const router = useRouter();
  const m = store.manifest;
  const { getStore } = useSolutionStore();
  const [hands, setHands] = useState<StoredHand[] | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [paste, setPaste] = useState("");
  const [filter, setFilter] = useState<HandFilter>({ seat: null, mistakesOnly: true, spot: null, sort: "loss" });
  const [shown, setShown] = useState(PAGE);
  const [note, setNote] = useState("");

  const refresh = useCallback(() => {
    getRepo()
      .listHands()
      .then(setHands)
      .catch(() => setHands([]));
  }, []);
  useEffect(refresh, [refresh]);

  const importTexts = async (texts: string[]) => {
    const repo = getRepo();
    const have = new Set((await repo.listHands()).map((h) => h.id));
    const rep: Report = { total: 0, added: 0, dup: 0, skipped: {} };
    const todo: ReturnType<typeof parseHandHistory>["hands"] = [];
    for (const text of texts) {
      const r = parseHandHistory(text);
      rep.total += r.blocks;
      for (const s of r.skipped) rep.skipped[s.reason] = (rep.skipped[s.reason] ?? 0) + 1;
      for (const h of r.hands) {
        if (have.has(h.id)) rep.dup++;
        else {
          have.add(h.id);
          todo.push(h);
        }
      }
    }
    setBusy({ done: 0, total: todo.length });
    const out: StoredHand[] = [];
    for (let i = 0; i < todo.length; i++) {
      const n = normalizeHand(todo[i]);
      if ("reason" in n) {
        rep.skipped[n.reason] = (rep.skipped[n.reason] ?? 0) + 1;
      } else {
        // each hand is graded against the solution whose depth is closest to its effective stack
        const eff = effectiveStack(n);
        const src = eff >= MIN_STACK && eff <= MAX_STACK ? await getStore(nearestDepth(eff)).catch(() => store) : store;
        out.push({ id: n.id, site: todo[i].site, ts: n.ts, importedAt: Date.now(), hand: n, analysis: await analyzeHand(src, n) });
      }
      if (i % 20 === 0) setBusy({ done: i, total: todo.length });
    }
    await repo.putHands(out);
    rep.added = out.length;
    setBusy(null);
    setReport(rep);
    setShown(PAGE);
    refresh();
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const texts = await Promise.all([...files].map((f) => f.text()));
    await importTexts(texts);
  };

  const list = hands ?? [];
  const summary = useMemo(() => summarize(list), [list]);
  const weak = useMemo(() => weakSpots(list), [list]);
  const view = useMemo(() => filterHands(list, filter), [list, filter]);

  const makeSet = async (seat?: number, spot?: SpotType) => {
    // one solution (stack depth) per set: the one with the most mistakes
    const solution = mistakeSolution(list, seat, spot);
    const items = solution ? practiceItems(list, 30, seat, spot, solution) : [];
    if (!solution || !items.length) {
      setNote(t("analyze.setNone"));
      return;
    }
    const id = `a${Date.now().toString(36)}`;
    await getRepo().setMeta(`practiceSet:${id}`, { title: `${t("analyze.setTitle")} · ${depthOf(solution)}bb`, solution, items });
    router.push(`/practice/#set=${id}`);
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold">{t("analyze.title")}</h1>
        <p className="text-sm text-muted">{t("analyze.subtitle")}</p>
      </header>
      <ReviewTabs />

      {/* import */}
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label={t("analyze.import")}>
        <h2 className="font-bold">{t("analyze.import")}</h2>
        <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-accent px-4 font-bold text-accent-ink focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus)]">
          {t("analyze.pickFiles")}
          <input type="file" multiple accept=".txt,text/plain" data-testid="hh-file" className="sr-only" onChange={(e) => onFiles(e.target.files)} disabled={!!busy} />
        </label>
        <details>
          <summary className="min-h-10 cursor-pointer text-sm font-semibold">{t("analyze.paste")}</summary>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            data-testid="hh-paste"
            rows={5}
            spellCheck={false}
            placeholder={t("analyze.pasteHint")}
            className="mt-2 w-full rounded-xl border border-line bg-surface-2 p-2 font-mono text-xs"
          />
          <button type="button" data-testid="hh-run" disabled={!paste.trim() || !!busy} onClick={() => importTexts([paste]).then(() => setPaste(""))} className="mt-2 min-h-11 rounded-xl border border-accent px-4 font-bold text-accent-text disabled:opacity-50">
            {t("analyze.run")}
          </button>
        </details>
        <p className="text-xs text-muted">{t("analyze.privacy")}</p>
        <p className="text-xs text-muted">{t("analyze.limits")}</p>
        {busy && (
          <p role="status" className="text-sm font-semibold">
            {t("analyze.working", { done: busy.done, total: busy.total })}
          </p>
        )}
        {report && (
          <div role="status" data-testid="hh-report" className="space-y-1 text-sm">
            <p className="font-semibold">{report.total === 0 ? t("analyze.noHands") : t("analyze.result", { total: report.total, added: report.added, dup: report.dup, skipped: Object.values(report.skipped).reduce((a, b) => a + b, 0) })}</p>
            {Object.keys(report.skipped).length > 0 && (
              <details>
                <summary className="cursor-pointer text-muted">{t("analyze.skipList")}</summary>
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {Object.entries(report.skipped).map(([reason, n]) => (
                    <li key={reason}>
                      {reason} × {n}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {hands === null ? null : list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{t("analyze.empty")}</p>
      ) : (
        <>
          {/* summary */}
          <section aria-label={t("analyze.summary")} className="space-y-3">
            <h2 className="font-bold">{t("analyze.summary")}</h2>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="hh-summary">
              {(
                [
                  [t("analyze.sum.hands"), String(summary.hands)],
                  [t("analyze.sum.decisions"), String(summary.decisions)],
                  [t("analyze.sum.loss"), `−${summary.lossPer100.toFixed(1)}bb`],
                  [t("analyze.sum.net"), `${summary.netPer100 >= 0 ? "+" : "−"}${Math.abs(summary.netPer100).toFixed(1)}bb`],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-2xl border border-line bg-surface p-3">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="text-xl font-extrabold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-1.5" aria-label="grades">
              {(["best", "correct", "inaccurate", "mistake", "blunder"] as const).map((g) => (
                <span key={g} className="flex items-center gap-1 text-sm">
                  <GradeBadge grade={g} />
                  <b className="tabular-nums">{summary.byGrade[g]}</b>
                </span>
              ))}
            </div>
          </section>

          {/* weak spots */}
          <section className="space-y-2" aria-label={t("analyze.weak")}>
            <h2 className="font-bold">{t("analyze.weak")}</h2>
            {weak.length === 0 ? (
              <p className="text-sm text-muted">{t("stats.weakNone")}</p>
            ) : (
              <ul className="space-y-2" data-testid="hh-weak">
                {weak.map((w) => (
                  <li key={`${w.seat}${w.spot}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">
                        {SEAT_NAMES[w.seat]} · {t(`spot.${w.spot}` as Key)}
                      </p>
                      <p className="text-xs text-muted">{t("analyze.weak.row", { n: w.n, avg: w.avgLoss.toFixed(2), total: w.totalLoss.toFixed(1) })}</p>
                    </div>
                    <button type="button" onClick={() => makeSet(w.seat, w.spot)} className="min-h-10 rounded-lg border border-accent px-3 text-sm font-bold text-accent-text">
                      {t("analyze.weak.practice")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" data-testid="hh-make-set" onClick={() => makeSet()} className="min-h-12 w-full rounded-2xl bg-accent font-bold text-accent-ink">
              {t("analyze.makeSet")}
            </button>
            {note && (
              <p role="status" className="text-sm text-muted">
                {note}
              </p>
            )}
          </section>

          {/* list */}
          <section className="space-y-3" aria-label={t("analyze.hands")}>
            <h2 className="font-bold">{t("analyze.hands")}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" aria-pressed={filter.mistakesOnly} onClick={() => setFilter({ ...filter, mistakesOnly: !filter.mistakesOnly })} className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${filter.mistakesOnly ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}>
                {t("analyze.f.mistakes")}
              </button>
              <select aria-label={t("analyze.f.seat")} value={filter.seat ?? ""} onChange={(e) => setFilter({ ...filter, seat: e.target.value === "" ? null : Number(e.target.value) })} className="min-h-10 rounded-full border border-line bg-surface px-3 text-sm">
                <option value="">{t("analyze.f.seat")}: {t("analyze.f.all")}</option>
                {SEAT_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
              <select aria-label="sort" value={filter.sort} onChange={(e) => setFilter({ ...filter, sort: e.target.value as HandFilter["sort"] })} className="min-h-10 rounded-full border border-line bg-surface px-3 text-sm">
                <option value="loss">{t("analyze.sort.loss")}</option>
                <option value="recent">{t("analyze.sort.recent")}</option>
              </select>
            </div>
            <ul className="space-y-3" data-testid="hh-list">
              {view.slice(0, shown).map((h) => (
                <HandCard key={h.id} h={h} onChange={refresh} />
              ))}
            </ul>
            {view.length > shown && (
              <button type="button" onClick={() => setShown(shown + PAGE)} className="min-h-11 w-full rounded-xl border border-line font-semibold">
                {t("analyze.more")}
              </button>
            )}
          </section>
          <button
            type="button"
            onClick={async () => {
              if (confirm(t("analyze.clearAsk"))) {
                await getRepo().clearHands();
                setReport(null);
                refresh();
              }
            }}
            className="min-h-11 text-sm text-muted underline"
          >
            {t("analyze.clear")}
          </button>
        </>
      )}
    </div>
  );
}

/** the manifest of the solution a stored hand was graded against (needed for action names) */
function useManifestOf(solution: string): Manifest | null {
  const { getStore } = useSolutionStore();
  const [m, setM] = useState<Manifest | null>(null);
  useEffect(() => {
    let alive = true;
    getStore(depthOf(solution))
      .then((s) => alive && setM(s.manifest))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [solution, getStore]);
  return m;
}

function actionText(m: Manifest, nodeId: number, idx: number, t: (k: Key) => string): string {
  const node = m.nodes[nodeId];
  const a = node.actions[idx];
  const base = actionLabel(a, node.actor, stateAt(m, nodeId), t);
  return a.kind >= ActionKind.Raise ? `${base} ${fmtBB(a.to)}` : base;
}

function HandCard({ h, onChange }: { h: StoredHand; onChange: () => void }) {
  const { t } = useSettings();
  const router = useRouter();
  const m = useManifestOf(solutionOf(h));
  const a = h.analysis;
  const [c1, c2] = h.hand.heroCards;
  const net = h.hand.heroNet;
  const openSolve = () => {
    const l = a.flopLink!;
    saveDraft({ board: l.board, oopText: l.oopText, ipText: l.ipText, oopName: SEAT_NAMES[l.oopSeat], ipName: SEAT_NAMES[l.ipSeat], pot: l.pot, stack: l.stack });
    router.push("/solve/");
  };
  return (
    <li className="space-y-2 rounded-2xl border border-line bg-surface p-3" data-testid="hh-hand">
      <div className="flex items-center gap-3">
        <span className="flex shrink-0 gap-0.5">
          <PlayingCard card={cardOf(c1)} size="sm" />
          <PlayingCard card={cardOf(c2)} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {SEAT_NAMES[h.hand.heroSeat]} <span className="text-xs font-semibold text-muted">· {t("analyze.stackNote", { n: Math.round(h.hand.stacks[h.hand.heroSeat]) })}</span>
          </p>
          <p className="text-xs text-muted">
            {new Date(h.ts).toLocaleDateString()} · {t("analyze.result.net", { n: `${net >= 0 ? "+" : "−"}${Math.abs(net).toFixed(1)}` })}
          </p>
        </div>
        {a.evLoss > 0.005 && <span className="text-lg font-extrabold tabular-nums text-[color:var(--g-blunder)]">{t("analyze.loss", { n: a.evLoss.toFixed(2) })}</span>}
      </div>

      {a.status === "skipped" && <p className="text-sm text-muted">{t("analyze.skipped", { reason: a.reason ?? "" })}</p>}
      {a.status === "partial" && <p className="text-xs text-muted">{t("analyze.partial", { reason: a.reason ?? "" })}</p>}

      <ul className="space-y-1.5">
        {a.decisions.map((d, i) => (
          <DecisionRow key={i} d={d} m={m} />
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {a.worst && (
          <Link href={`/study/#d=${depthOf(a.solution)}&n=${a.worst.nodeId}`} className="min-h-10 rounded-lg border border-line px-3 py-2 text-sm font-semibold">
            {t("analyze.openStudy")}
          </Link>
        )}
        {a.flopLink && (
          <button type="button" data-testid="hh-solve" onClick={openSolve} title={t("analyze.solveHint", { pot: a.flopLink.pot, stack: a.flopLink.stack })} className="min-h-10 rounded-lg border border-accent px-3 text-sm font-bold text-accent-text">
            {t("analyze.openSolve")}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            await getRepo().deleteHand(h.id);
            onChange();
          }}
          className="ml-auto min-h-10 px-2 text-sm text-muted"
        >
          {t("analyze.delete")}
        </button>
      </div>
      {!a.flopLink && h.hand.board.length >= 3 && <p className="text-xs text-muted">{t("analyze.noPostflop")}</p>}
    </li>
  );
}

function DecisionRow({ d, m }: { d: DecisionInfo; m: Manifest | null }) {
  const { t } = useSettings();
  const tt = t as (k: Key) => string;
  if (!m) return <li className="rounded-xl bg-surface-2 p-2 text-sm text-muted">…</li>;
  const acts = m.nodes[d.nodeId].actions;
  return (
    <li className="rounded-xl bg-surface-2 p-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <GradeBadge grade={d.grade} />
        <span className="text-sm">
          <span className="text-muted">{t(`spot.${d.spot}` as Key)} · </span>
          {t("analyze.you")}: <b>{actionText(m, d.nodeId, d.chosen, tt)}</b> ({Math.round(d.stats[d.chosen].freq * 100)}%)
          {d.best !== d.chosen && (
            <>
              {" · "}
              {t("analyze.solution")}: <b>{actionText(m, d.nodeId, d.best, tt)}</b> ({Math.round(d.stats[d.best].freq * 100)}%)
            </>
          )}
        </span>
        {d.evLoss > 0.005 && <span className="ml-auto font-bold tabular-nums">{t("analyze.loss", { n: d.evLoss.toFixed(2) })}</span>}
      </div>
      {d.sizeNote && <p className="mt-1 text-xs text-muted">{t("analyze.sizeNote", { real: fmtBB(d.sizeNote.real), tree: fmtBB(d.sizeNote.tree) })}</p>}
      <details className="mt-1">
        <summary className="min-h-9 cursor-pointer text-xs font-semibold text-muted">{t("analyze.details")}</summary>
        <table className="mt-1 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="font-semibold">
                {t("analyze.col.action")}
              </th>
              <th scope="col" className="text-right font-semibold">
                {t("analyze.col.freq")}
              </th>
              <th scope="col" className="text-right font-semibold">
                {t("analyze.col.ev")}
              </th>
            </tr>
          </thead>
          <tbody>
            {acts.map((_, i) => (
              <tr key={i} className={i === d.chosen ? "font-bold" : ""}>
                <th scope="row" className="py-0.5 text-left font-inherit">
                  {actionText(m, d.nodeId, i, tt)}
                  {i === d.chosen ? " ◀" : ""}
                </th>
                <td className="text-right tabular-nums">{Math.round(d.stats[i].freq * 100)}%</td>
                <td className="text-right tabular-nums">{d.stats[i].ev.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </li>
  );
}
