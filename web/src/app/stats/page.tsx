"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Ring } from "@/components/Charts";
import { IconFlame } from "@/components/icons";
import { Skeleton } from "@/components/Skeleton";
import { useSettings } from "@/lib/settings";
import { SEATS } from "@/lib/solution/tree";
import { ALL_SPOT_COLUMNS } from "@/lib/solution/types";
import { getRepo } from "@/lib/storage/idb";
import { dailySeries, heatmap, studyStreak, summarize, todayCount, weakSpots } from "@/lib/storage/stats";
import type { Attempt } from "@/lib/storage/types";
import { GRADES } from "@/lib/practice/grading";
import { GRADE_GLYPH, gradeColor } from "@/components/practice/ResultPanel";
import type { Key } from "@/lib/i18n/ja";

function lossColor(loss: number): string {
  const t = Math.min(1, loss / 0.5);
  return `color-mix(in oklab, var(--g-blunder) ${Math.round(t * 70)}%, var(--surface-2))`;
}

export default function StatsPage() {
  const { t, settings } = useSettings();
  const [list, setList] = useState<Attempt[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    getRepo()
      .allAttempts()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(load, [load]);

  const now = Date.now();
  const sum = useMemo(() => summarize(list ?? []), [list]);
  const series = useMemo(() => dailySeries(list ?? [], 30, now), [list, now]);
  const heat = useMemo(() => heatmap(list ?? []), [list]);
  const weak = useMemo(() => weakSpots(list ?? [], 3, 5), [list]);
  const streak = studyStreak(list ?? [], now);
  const today = todayCount(list ?? [], now);
  const byGrade = useMemo(() => {
    const c: Record<string, number> = { best: 0, correct: 0, inaccurate: 0, mistake: 0, blunder: 0 };
    for (const a of list ?? []) c[a.grade]++;
    return c;
  }, [list]);

  const exportData = async () => {
    const blob = new Blob([JSON.stringify(await getRepo().exportAll())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tessera-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importData = async (f: File) => {
    try {
      await getRepo().importAll(JSON.parse(await f.text()));
      setNote(t("stats.imported"));
      load();
    } catch (e) {
      setNote(String(e));
    }
  };

  if (!list)
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold">{t("stats.title")}</h1>
        <p className="text-sm text-muted">{t("stats.subtitle")}</p>
      </header>

      <section className="grid grid-cols-[auto_1fr] items-center gap-4 rounded-3xl border border-line bg-surface p-4">
        <Ring value={today} max={settings.dailyGoal} label={t("stats.goalHands", { n: today, goal: settings.dailyGoal })}>
          <div className="text-2xl font-black" data-testid="today-count">
            {today}
          </div>
          <div className="text-[0.65rem] text-muted">/ {settings.dailyGoal}</div>
        </Ring>
        <div className="space-y-2">
          <p className="text-sm font-bold">{t("stats.goal")}</p>
          <p className="flex items-center gap-1.5 text-lg font-extrabold text-accent-text">
            <IconFlame width={22} height={22} />
            <span data-testid="streak-days">{t("stats.days", { n: streak })}</span>
          </p>
          <p className="text-xs text-muted">{t("stats.streakDays")}</p>
        </div>
      </section>

      {sum.n === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 text-center">
          <p className="text-muted">{t("stats.empty")}</p>
          <Link href="/practice/" className="mt-3 inline-grid min-h-12 place-items-center rounded-xl bg-accent px-6 font-bold text-accent-ink">
            {t("home.continue")}
          </Link>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              [t("stats.attempts"), String(sum.n)],
              [t("stats.accuracy"), `${Math.round(sum.accuracy * 100)}%`],
              [t("stats.avgLoss"), `${sum.avgLoss.toFixed(2)}bb`],
              [t("stats.avgScore"), sum.avgScore.toFixed(0)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-surface p-3 text-center">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-2xl font-black">{v}</dd>
              </div>
            ))}
          </dl>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-2 font-bold">{t("stats.trend")}</h2>
            <LineChart label={t("stats.trend")} values={series.map((d) => (d.n ? Math.round(d.avgScore) : null))} labels={[series[0].date.slice(5), series[series.length - 1].date.slice(5)]} />
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-2 font-bold">{t("stats.gradeDist")}</h2>
            <div className="flex h-4 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={t("stats.gradeDist")}>
              {GRADES.map((g) => (
                <span key={g} style={{ width: `${(byGrade[g] / sum.n) * 100}%`, background: gradeColor(g) }} />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {GRADES.map((g) => (
                <li key={g} style={{ color: gradeColor(g) }} className="font-semibold">
                  {GRADE_GLYPH[g]} {t(`grade.${g}` as Key)} {byGrade[g]}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-bold">{t("stats.heatmap")}</h2>
            <p className="mb-2 text-xs text-muted">{t("stats.heatmapHint")}</p>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[44rem] border-separate border-spacing-1 text-center text-xs" data-testid="heatmap">
                <thead>
                  <tr>
                    <th scope="col" />
                    {ALL_SPOT_COLUMNS.map((s) => (
                      <th key={s} scope="col" className="px-1 pb-1 font-semibold text-muted">
                        {t(`spot.${s}` as Key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SEATS.map((seat, si) => (
                    <tr key={seat}>
                      <th scope="row" className="pr-1 text-left font-bold">
                        {seat}
                      </th>
                      {ALL_SPOT_COLUMNS.map((s) => {
                        const c = heat.find((h) => h.seat === si && h.spot === s);
                        return (
                          <td key={s} className="h-9 rounded-md" style={{ background: c ? lossColor(c.avgLoss) : "var(--surface-2)", opacity: c ? 1 : 0.5 }} title={c ? `${c.avgLoss.toFixed(2)}bb · ${c.n}` : t("stats.noDataCell")}>
                            {c ? <span className="font-bold">{c.avgLoss.toFixed(2)}</span> : <span className="text-muted">–</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-2 font-bold">{t("stats.weak")}</h2>
            {weak.length === 0 ? (
              <p className="text-sm text-muted">{t("stats.weakNone")}</p>
            ) : (
              <ul className="space-y-2">
                {weak.map((w) => (
                  <li key={`${w.seat}-${w.spot}`} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
                    <span>
                      <b>{SEATS[w.seat]}</b> · {t(`spot.${w.spot}` as Key)}
                      <span className="block text-xs text-muted">
                        {t("stats.avgLoss")} {w.avgLoss.toFixed(2)}bb · {t("stats.nSamples", { n: w.n })}
                      </span>
                    </span>
                    <Link href={`/practice/#seat=${w.seat}&spot=${w.spot}`} className="min-h-10 shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-bold text-accent-ink">
                      {t("stats.makeSet")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-bold">{t("stats.sync")}</h2>
        <p className="mb-3 mt-1 text-sm text-muted">{t("stats.syncDesc")}</p>
        <div className="flex gap-2">
          <button type="button" onClick={exportData} className="min-h-11 flex-1 rounded-xl border border-line font-semibold">
            {t("stats.export")}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="min-h-11 flex-1 rounded-xl border border-line font-semibold">
            {t("stats.import")}
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
        </div>
        {note && (
          <p role="status" className="mt-2 text-sm text-accent-text">
            {note}
          </p>
        )}
      </section>
    </div>
  );
}
