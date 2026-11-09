"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Ring } from "@/components/Charts";
import { CrashProbe } from "@/components/CrashProbe";
import { IconFlame, IconBolt, IconGrid, IconTarget } from "@/components/icons";
import { useSettings } from "@/lib/settings";
import { useNow } from "@/lib/util/hooks";
import { SEATS } from "@/lib/solution/tree";
import { getRepo } from "@/lib/storage/idb";
import { studyStreak, todayCount, weakSpots } from "@/lib/storage/stats";
import type { Attempt } from "@/lib/storage/types";
import type { Key } from "@/lib/i18n/ja";

export default function Home() {
  const { t, settings } = useSettings();
  const [list, setList] = useState<Attempt[]>([]);
  useEffect(() => {
    getRepo().allAttempts().then(setList).catch(() => {});
  }, []);
  const now = useNow();
  const today = todayCount(list, now);
  const streak = studyStreak(list, now);
  const weak = useMemo(() => weakSpots(list, 3, 2), [list]);

  return (
    <div className="space-y-5">
      <CrashProbe tag="page" />
      <header className="pt-2">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden>
            <rect width="64" height="64" rx="14" fill="#0e3a31" />
            <g fill="#e9b949">
              <rect x="10" y="10" width="20" height="20" rx="4" />
              <rect x="34" y="10" width="20" height="20" rx="4" opacity=".55" />
              <rect x="10" y="34" width="20" height="20" rx="4" opacity=".55" />
              <rect x="34" y="34" width="20" height="20" rx="4" />
            </g>
          </svg>
          <div>
            <h1 className="text-2xl font-black tracking-tight">{t("app.name")}</h1>
            <p className="text-sm text-muted">{t("app.tagline")}</p>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-[auto_1fr] items-center gap-4 rounded-sheet border border-line bg-surface p-4">
        <Ring value={today} max={settings.dailyGoal} label={t("stats.goalHands", { n: today, goal: settings.dailyGoal })}>
          <div className="text-2xl font-black">{today}</div>
          <div className="text-[0.65rem] text-muted">/ {settings.dailyGoal}</div>
        </Ring>
        <div>
          <p className="font-bold">{t("home.goalToday")}</p>
          <p className="mt-0.5 flex items-center gap-1 font-extrabold text-accent-text">
            <IconFlame width={20} height={20} /> {t("stats.days", { n: streak })}
          </p>
          <p className="mt-1 text-xs text-muted">{t("home.hello")}</p>
        </div>
      </section>

      <Link href="/practice/" data-testid="cta-practice" className="flex min-h-16 items-center justify-center gap-3 rounded-sheet bg-accent text-lg font-black text-accent-ink shadow-lg active:scale-[0.98]">
        <IconTarget width={26} height={26} />
        {t("home.continue")}
      </Link>
      <Link href="/study/" data-testid="cta-study" className="flex min-h-cta items-center justify-center gap-3 rounded-sheet border border-line bg-surface font-bold">
        <IconGrid width={22} height={22} />
        {t("home.study")}
      </Link>
      <Link href="/solve/" data-testid="cta-solve" className="flex min-h-cta items-center justify-center gap-3 rounded-sheet border border-line bg-surface font-bold">
        <IconBolt width={22} height={22} />
        {t("home.solve")}
      </Link>

      {weak.length > 0 && (
        <section className="rounded-card border border-line bg-surface p-4">
          <h2 className="mb-2 font-bold">{t("home.weakTitle")}</h2>
          <ul className="space-y-2">
            {weak.map((w) => (
              <li key={`${w.seat}${w.spot}`}>
                <Link href={`/practice/#seat=${w.seat}&spot=${w.spot}`} className="flex min-h-tap-lg items-center justify-between rounded-control bg-surface-2 px-3">
                  <span>
                    <b>{SEATS[w.seat]}</b> · {t(`spot.${w.spot}` as Key)}
                  </span>
                  <span className="text-sm text-muted">{w.avgLoss.toFixed(2)}bb</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-center text-xs text-muted">
        {t("home.dataNote")} · {t("home.offline")}
      </p>
    </div>
  );
}
