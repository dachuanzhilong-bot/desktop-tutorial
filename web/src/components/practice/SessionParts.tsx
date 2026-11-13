"use client";
/** Pieces of the practice session screen (components/practice/Session.tsx), split out to keep it short (REFACTOR_PLAN 2-2). */
import { motion } from "framer-motion";
import { IconFlame, IconX } from "@/components/icons";
import { GridAction } from "@/components/RangeGrid";
import type { Question } from "@/lib/practice/engine";
import { Result, sessionStats } from "@/lib/practice/session";
import { useSettings } from "@/lib/settings";
import { ActionKind } from "@/lib/solution/types";

/** finish button and the running count, streak and total */
export function SessionTopBar({ results, onFinish }: { results: Result[]; onFinish: () => void }) {
  const { t } = useSettings();
  const stats = sessionStats(results);
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={t("practice.finish")} onClick={onFinish} data-testid="finish" className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-muted">
        <IconX width={20} height={20} />
      </button>
      <div className="flex flex-1 items-center justify-center gap-4 text-sm font-bold" aria-live="polite">
        <span data-testid="hands-count">
          {t("practice.hands")} <span className="text-base">{stats.n}</span>
        </span>
        <span className="flex items-center gap-1 text-accent-text" data-testid="streak">
          <IconFlame width={18} height={18} />
          {stats.streak}
        </span>
        <span>
          {t("practice.total")} <span className="text-base">{stats.totalScore}</span>
        </span>
      </div>
      <span className="w-11" />
    </div>
  );
}

/** the time limit bar: runs down over `seconds`, from full again whenever `restart` changes */
export function TimerBar({ seconds, restart }: { seconds: number; restart: string }) {
  const { t } = useSettings();
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="timer" aria-label={t("practice.timer")}>
      <motion.div key={restart} className="h-full bg-accent" initial={{ width: "100%" }} animate={{ width: "0%" }} transition={{ duration: seconds, ease: "linear" }} />
    </div>
  );
}

/** RNG mode: the roll and the frequencies laid out the way the roll is read */
export function RngPanel({ q, metaActions, actions }: { q: Question; metaActions: { kind: ActionKind }[]; actions: GridAction[] }) {
  const { t } = useSettings();
  const rngRoll = q.roll != null ? Math.floor(q.roll * 100) + 1 : null;
  return (
    <div className="rounded-card border border-accent/60 bg-accent/10 p-3" data-testid="rng-panel">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold">{t("practice.rngInstruction")}</span>
        <span className="rounded-control bg-accent px-2.5 py-1 text-xl font-black text-accent-ink" data-testid="rng-roll" aria-label={t("practice.rngRoll")}>
          {rngRoll}
        </span>
      </div>
      <div className="flex h-5 overflow-hidden rounded-full text-[0.65rem] font-bold text-white" aria-hidden>
        {rngOrderBar(q, metaActions, actions).map((s, i) => (
          <span key={i} className="seg grid place-items-center" data-k={s.tone} style={{ width: `${s.f * 100}%` }}>
            {s.f > 0.12 ? `${s.label} ${Math.round(s.f * 100)}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** RNG bar: frequencies laid out raise -> call -> fold, matching how the roll is interpreted */
function rngOrderBar(q: Question, metaActions: { kind: ActionKind }[], actions: GridAction[]) {
  const rank = (k: ActionKind) => (k === ActionKind.AllIn ? 0 : k === ActionKind.Raise ? 1 : k === ActionKind.Call ? 2 : 3);
  return metaActions
    .map((a, i) => ({ i, r: rank(a.kind) }))
    .sort((x, y) => x.r - y.r)
    .map(({ i }) => ({ tone: actions[i].tone, label: actions[i].label, f: q.stats[i].freq }));
}
