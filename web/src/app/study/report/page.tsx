"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import { Skeleton } from "@/components/Skeleton";
import { StudyTabs } from "@/components/StudyTabs";
import type { Key } from "@/lib/i18n/ja";
import { cardOf, parseBoard } from "@/lib/postflop/combos";
import { loadIndex, PfIndex } from "@/lib/postflop/loader";
import { textureOf } from "@/lib/postflop/texture";
import { GROUPS, GroupBy, groupAverages, Metric, METRICS, metricOf } from "@/lib/postflop/report";
import { useSettings } from "@/lib/settings";

function Report({ index }: { index: PfIndex }) {
  const { t } = useSettings();
  const [scenario, setScenario] = useState(index.scenarios[0]?.id ?? "");
  const [group, setGroup] = useState<GroupBy>("high");
  const [metric, setMetric] = useState<Metric>("ipBet");
  const sc = index.scenarios.find((s) => s.id === scenario)!;

  const rows = useMemo(
    () =>
      index.flops.map((f, i) => {
        const board = parseBoard(f);
        return { i, text: f, board, tex: textureOf(board), stats: index.stats[`${scenario}/${i}`] };
      }),
    [index, scenario],
  );
  const groups = useMemo(() => groupAverages(rows.map((r) => ({ tex: r.tex, v: metricOf(metric, r.stats, sc.pot) })), group), [rows, group, metric, sc.pot]);
  const labelOf = (g: GroupBy, k: string) => (g === "high" ? t(`rep.high.${k}` as Key) : g === "suit" ? t(`rep.suit.${k}` as Key) : g === "connect" ? t(`rep.connect.${k}` as Key) : t(`rep.paired.${k}` as Key));
  const overall = rows.map((r) => metricOf(metric, r.stats, sc.pot)).filter((v): v is number => v !== null);
  const mean = overall.length ? overall.reduce((a, b) => a + b, 0) / overall.length : 0;
  const [sort, setSort] = useState<"order" | "desc">("order");
  const table = useMemo(() => {
    const t0 = rows.map((r) => ({ ...r, v: metricOf(metric, r.stats, sc.pot) }));
    return sort === "desc" ? [...t0].sort((a, b) => (b.v ?? -1) - (a.v ?? -1)) : t0;
  }, [rows, metric, sc.pot, sort]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">{t("rep.title")}</h1>
        <p className="text-sm text-muted">{t("rep.subtitle")}</p>
      </header>
      <StudyTabs />

      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {index.scenarios.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === scenario} onClick={() => setScenario(s.id)} className={`min-h-10 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold ${s.id === scenario ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}>
            {s.title}
          </button>
        ))}
      </div>

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label={t("rep.by")}>
        <div>
          <p className="mb-1 text-xs font-bold text-muted">{t("rep.by")}</p>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => (
              <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${group === g ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-2 text-muted"}`}>
                {t(`rep.by.${g}` as Key)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-bold text-muted">{t("rep.metric")}</p>
          <div className="flex flex-wrap gap-1.5">
            {METRICS.map((m) => (
              <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${metric === m ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-2 text-muted"}`}>
                {t(`rep.m.${m}` as Key)}
              </button>
            ))}
          </div>
        </div>

        <ul className="space-y-2" aria-label={t(`rep.m.${metric}` as Key)} data-testid="rep-bars">
          {groups.map((g) => (
            <li key={g.key} className="grid grid-cols-[6.5rem_1fr_3.2rem] items-center gap-2 text-sm">
              <span className="font-semibold">
                {labelOf(group, g.key)} <span className="text-xs font-normal text-muted">({g.n})</span>
              </span>
              <span className="relative h-5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${(g.avg * 100).toFixed(0)}%`}>
                <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, g.avg * 100)}%` }} />
                <span className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: `${Math.min(100, mean * 100)}%` }} aria-hidden />
              </span>
              <span className="text-right font-extrabold tabular-nums">{(g.avg * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          {t("rep.col.avg")} {(mean * 100).toFixed(0)}% · {t("rep.note", { n: index.flops.length })}
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4" aria-label={t("rep.table")}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">{t("rep.table")}</h2>
          <button type="button" onClick={() => setSort(sort === "order" ? "desc" : "order")} className="min-h-9 rounded-full border border-line px-3 text-xs font-semibold text-muted">
            {sort === "order" ? "↓ " : "# "}
            {t(`rep.m.${metric}` as Key)}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] text-sm" data-testid="rep-table">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="pb-1 font-semibold">
                  {t("rep.col.board")}
                </th>
                <th scope="col" className="pb-1 text-right font-semibold">
                  {t(`rep.m.${metric}` as Key)}
                </th>
                <th scope="col" className="pb-1 text-right font-semibold">
                  {t(`rep.m.eqIp` as Key)}
                </th>
                <th scope="col" className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.i} className="border-t border-line">
                  <th scope="row" className="py-1.5">
                    <span className="inline-flex gap-0.5" aria-label={r.text}>
                      {r.board.map((c) => (
                        <PlayingCard key={c} card={cardOf(c)} size="sm" />
                      ))}
                    </span>
                  </th>
                  <td className="text-right font-bold tabular-nums">{r.v === null ? "–" : `${(r.v * 100).toFixed(0)}%`}</td>
                  <td className="text-right tabular-nums text-muted">{r.stats ? `${(r.stats.eqIp * 100).toFixed(0)}%` : "–"}</td>
                  <td className="text-right">
                    <Link href={`/study/postflop/#s=${scenario}&f=${r.i}&n=0`} className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-muted">
                      {t("rep.open")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function ReportPage() {
  const [index, setIndex] = useState<PfIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { t } = useSettings();
  useEffect(() => {
    loadIndex().then(setIndex).catch((e) => setErr(String(e?.message ?? e)));
  }, []);
  if (err) return <p role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">{t("pf.missing")} {err}</p>;
  if (!index)
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  return <Report index={index} />;
}
