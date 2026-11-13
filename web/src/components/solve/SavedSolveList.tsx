"use client";
import Link from "next/link";
import { PlayingCard } from "@/components/PlayingCard";
import { cardOf } from "@/lib/postflop/combos";
import { fmtBB } from "@/lib/solution/tree";
import { useSettings } from "@/lib/settings";
import type { SolveConfig } from "@/lib/solve/config";
import type { SavedSolve } from "@/lib/storage/types";

/** the solves saved on this device: open in Study, load back into the inputs, delete */
export function SavedSolveList({ mine, onLoad, onDelete }: { mine: SavedSolve[]; onLoad: (s: SavedSolve) => void; onDelete: (id: string) => void }) {
  const { t } = useSettings();
  return (
    <section className="space-y-2" aria-label={t("solve.mine")}>
      <h2 className="font-bold">{t("solve.mine")}</h2>
      {mine.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-4 text-sm text-muted">{t("solve.mineEmpty")}</p>
      ) : (
        <ul className="space-y-2" data-testid="saved-solves">
          {mine.map((s) => (
            <li key={s.id} className="rounded-card border border-line bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="flex shrink-0 gap-0.5">
                  {s.board.map((c) => (
                    <PlayingCard key={c} card={cardOf(c)} size="sm" />
                  ))}
                </span>
              </div>
              <p className="mt-1.5 truncate font-bold">{s.title}</p>
              <p className="text-xs text-muted">
                {new Date(s.ts).toLocaleString()} · Exploitability {s.exploit.toFixed(2)}% · {t("pf.pot", { pot: fmtBB((s.cfg as SolveConfig).pot), stack: fmtBB((s.cfg as SolveConfig).stack) })}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/study/postflop/#solve=${s.id}`} className="min-h-tap rounded-control bg-accent px-3.5 py-2 text-sm font-bold text-accent-ink">
                  {t("solve.openStudy")}
                </Link>
                <button type="button" onClick={() => onLoad(s)} className="min-h-tap rounded-control border border-line px-3.5 text-sm font-semibold">
                  {t("solve.reload")}
                </button>
                <button type="button" onClick={() => onDelete(s.id)} className="min-h-tap rounded-control px-3 text-sm text-muted">
                  {t("solve.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
