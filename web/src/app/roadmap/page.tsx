"use client";
import { useSettings } from "@/lib/settings";
import type { Key } from "@/lib/i18n/ja";

const PHASES = [
  { k: "roadmap.p1", done: true },
  { k: "roadmap.p2", done: true },
  { k: "roadmap.p3", done: true },
  { k: "roadmap.p4", done: true },
  { k: "roadmap.p5", done: true },
  { k: "roadmap.p6", done: true },
] as const;

export default function RoadmapPage() {
  const { t } = useSettings();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{t("roadmap.title")}</h1>
      <ol className="space-y-2">
        {PHASES.map((p, i) => (
          <li key={p.k} className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black ${p.done ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`}>{i + 1}</span>
            <span>
              <span className="block font-semibold">{t(p.k as Key)}</span>
              <span className="text-xs text-muted">{p.done ? t("roadmap.done") : t("roadmap.todo")}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
