"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import { GradeBadge } from "@/components/practice/ResultPanel";
import { judgeIcm, pickIcmQuestion } from "@/lib/icm/drill";
import type { IcmJudgement, IcmQuestion } from "@/lib/icm/drill";
import type { IcmSolution } from "@/lib/icm/model";
import { randomCombo } from "@/lib/poker/hands";
import type { Card } from "@/lib/poker/hands";
import { isGood } from "@/lib/practice/grading";
import { useSettings } from "@/lib/settings";
import { haptic } from "@/lib/util/haptics";
import { cryptoRandom } from "@/lib/util/rng";

interface Props {
  sol: IcmSolution;
  stacks: number[];
  positions: string[];
  hero: number;
}

/** random spots from a solved ICM table, graded by EV loss in % of the prize pool (session only, nothing is stored) */
export function IcmDrill({ sol, stacks, positions, hero }: Props) {
  const { t } = useSettings();
  const [active, setActive] = useState(false);
  const [player, setPlayer] = useState<number | "all">(hero);
  const [q, setQ] = useState<(IcmQuestion & { cards: [Card, Card] }) | null>(null);
  const [answer, setAnswer] = useState<IcmJudgement | null>(null);
  const [none, setNone] = useState(false);
  const [log, setLog] = useState<IcmJudgement[]>([]);

  const players = useMemo(() => [...new Set(sol.nodes.filter((n) => n.reach > 1e-6).map((n) => n.player))].sort((a, b) => a - b), [sol]);

  const next = useCallback((forPlayer: number | "all" = player) => {
    const who = forPlayer === "all" ? players[Math.floor(cryptoRandom() * players.length)] : forPlayer;
    const pick = pickIcmQuestion(sol, who, cryptoRandom);
    setAnswer(null);
    if (!pick) {
      setQ(null);
      setNone(true);
      return;
    }
    setNone(false);
    setQ({ ...pick, cards: randomCombo(pick.hand, cryptoRandom) });
  }, [sol, player, players]);

  const pickPlayer = (p: number | "all") => {
    setPlayer(p);
    if (active) next(p);
  };

  const answerWith = useCallback(
    (act: boolean) => {
      if (!q || answer) return;
      const j = judgeIcm(q, act);
      setAnswer(j);
      setLog((l) => [...l, j]);
      if (isGood(j.grade)) haptic.good();
      else haptic.bad();
    },
    [q, answer],
  );

  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest("input,select,textarea")) return;
      const k = e.key.toLowerCase();
      if (!answer && k === "f") answerWith(false);
      else if (!answer && (k === "j" || k === "c" || k === "r")) answerWith(true);
      else if (answer && (k === "enter" || k === " " || k === "n")) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [active, answer, answerWith, next]);

  const good = log.filter((j) => isGood(j.grade)).length;
  const avgLoss = log.length ? log.reduce((s, j) => s + j.evLoss, 0) / log.length : 0;
  const act = q?.node.facing === null || q?.node.facing === undefined ? t("icm.drill.jam") : t("icm.drill.call");
  const chip = (on: boolean) => `min-h-10 rounded-full border px-3 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`;

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label={t("icm.drill.title")} data-testid="icm-drill">
      <h2 className="font-bold">{t("icm.drill.title")}</h2>
      {!active ? (
        <>
          <p className="text-sm text-muted">{t("icm.drill.intro")}</p>
          <button type="button" data-testid="icm-drill-start" onClick={() => (setLog([]), setActive(true), next())} className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-ink">
            {t("icm.drill.start")}
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label={t("icm.drill.pos")}>
            <button type="button" aria-pressed={player === "all"} onClick={() => pickPlayer("all")} className={`${chip(player === "all")} whitespace-nowrap`}>
              {t("icm.drill.all")}
            </button>
            {players.map((p) => (
              <button key={p} type="button" aria-pressed={player === p} data-testid={`icm-drill-pos-${p}`} onClick={() => pickPlayer(p)} className={`${chip(player === p)} whitespace-nowrap`}>
                {positions[p]}
                {p === hero ? " ★" : ""}
              </button>
            ))}
          </div>
          {none || !q ? (
            <p className="text-sm text-muted">{t("icm.drill.none")}</p>
          ) : (
            <>
              <div className="rounded-xl bg-surface-2 p-3 text-sm" data-testid="icm-drill-question">
                <p className="font-bold">{t("icm.drill.you", { pos: positions[q.node.player], bb: stacks[q.node.player] })}</p>
                <p className="text-muted">{q.node.facing === null ? t("icm.drill.firstIn") : t("icm.drill.facing", { pos: positions[q.node.facing], bb: stacks[q.node.facing] })}</p>
                <p className="mt-1 text-xs text-muted">{positions.map((p, i) => (i === q.node.player ? null : t("icm.drill.table", { pos: p, bb: stacks[i] }))).filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex justify-center gap-2" aria-label={q.cards.map((c) => `${c.rank}${c.suit}`).join(" ")}>
                <PlayingCard card={q.cards[0]} size="md" key={`${q.cards[0].rank}${q.cards[0].suit}${log.length}a`} flip />
                <PlayingCard card={q.cards[1]} size="md" key={`${q.cards[1].rank}${q.cards[1].suit}${log.length}b`} flip delay={0.08} />
              </div>
              {!answer ? (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" data-testid="icm-drill-fold" onClick={() => answerWith(false)} className="seg min-h-14 rounded-2xl text-lg font-extrabold text-white" data-k="fold">
                    {t("icm.drill.fold")} <span className="text-xs opacity-90">F</span>
                  </button>
                  <button type="button" data-testid="icm-drill-act" onClick={() => answerWith(true)} className="seg min-h-14 rounded-2xl text-lg font-extrabold text-white" data-k={q.node.facing === null ? "allin" : "call"}>
                    {act} <span className="text-xs opacity-90">J</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2" data-testid="icm-drill-result" role="status">
                  <div className="flex flex-wrap items-center gap-2">
                    <GradeBadge grade={answer.grade} score={answer.score} />
                    <span className="font-bold tabular-nums">{t("icm.drill.loss", { x: answer.evLoss.toFixed(2) })}</span>
                  </div>
                  <p className="text-sm">{t("icm.drill.mix", { act, pct: Math.round(answer.actFreq * 100) })}</p>
                  <p className="text-xs text-muted">{t("icm.drill.ev", { act, evAct: answer.evAct.toFixed(2), evFold: answer.evFold.toFixed(2) })}</p>
                  <button type="button" data-testid="icm-drill-next" onClick={() => next()} className="min-h-12 w-full rounded-xl bg-accent font-bold text-accent-ink">
                    {t("icm.drill.next")}
                  </button>
                </div>
              )}
            </>
          )}
          <p className="text-sm text-muted" data-testid="icm-drill-stats" aria-live="polite">
            {t("icm.drill.stats", { n: log.length, acc: log.length ? Math.round((100 * good) / log.length) : 0, loss: avgLoss.toFixed(2) })}
          </p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">{t("icm.drill.note")}</p>
            <button type="button" onClick={() => setActive(false)} className="min-h-10 shrink-0 rounded-lg border border-line px-3 text-sm font-semibold">
              {t("icm.drill.end")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
