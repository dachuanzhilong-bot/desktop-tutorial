"use client";
import { useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ActionBar, BarAction } from "@/components/ActionBar";
import { ResultPanel } from "@/components/practice/ResultPanel";
import { SessionTopBar, TimerBar } from "@/components/practice/SessionParts";
import { SessionSummary } from "@/components/practice/Summary";
import { GridAction } from "@/components/RangeGrid";
import { Skeleton } from "@/components/Skeleton";
import { edgeTone, useEdgeText } from "@/components/postflop/edge";
import { PostTable, PostTableMini } from "@/components/postflop/PostTable";
import { COMBOS, cardOf } from "@/lib/postflop/combos";
import { createPostflopDrill, postTableView } from "@/lib/postflop/drillAdapter";
import { loadFlop, loadIndex, PfIndex } from "@/lib/postflop/loader";
import { labelEdge } from "@/lib/postflop/replay";
import type { PostConfig } from "@/lib/postflop/types";
import { useDrillSession } from "@/lib/practice/useDrillSession";
import { useSettings } from "@/lib/settings";
import { ActionKind } from "@/lib/solution/types";
import { fmtBB } from "@/lib/solution/tree";
import type { Repo } from "@/lib/storage/types";
import { haptic } from "@/lib/util/haptics";
import { cryptoRandom } from "@/lib/util/rng";

const STEP_MS = 560;
const KIND = [ActionKind.Fold, ActionKind.Call, ActionKind.Raise, ActionKind.AllIn];

/** the post-flop drill: the session (lib/practice/useDrillSession.ts) runs the post-flop game (lib/postflop/drillAdapter.ts); this draws it */
export function PostSession({ config, repo, onExit }: { config: PostConfig; repo: Repo; onExit: () => void }) {
  const { t } = useSettings();
  const reduce = useReducedMotion();
  const edgeText = useEdgeText();
  const [drill] = useState(() => createPostflopDrill({ config, repo, rnd: cryptoRandom, index: loadIndex, flop: loadFlop }));
  const [index, setIndex] = useState<PfIndex | null>(null);

  useEffect(() => {
    repo
      .allSrs()
      .then((all) => drill.setSrs(all))
      .catch(() => {});
    // the scenario's seat names; without the index the drill finds nothing ("empty")
    loadIndex()
      .then(setIndex)
      .catch(() => {});
  }, [repo, drill]);

  const sc = index?.scenarios.find((s) => s.id === config.scenario);
  const seatNames: [string, string] = sc ? [sc.oop, sc.ip] : ["OOP", "IP"];

  const ses = useDrillSession(drill, { timer: config.timer, stepMs: STEP_MS, reduceMotion: !!reduce, onExit });
  const { phase, round, shown, answer, results, pane } = ses;
  const hintIdx = ses.hint.index;

  // what the table shows right now
  const view = useMemo(() => {
    if (!round) return null;
    const v = postTableView(round, shown, phase, answer ? answer.j.chosen : null);
    return { ...v, last: v.last.map((l) => (l ? edgeText(l) : null)) };
  }, [round, shown, phase, answer, edgeText]);

  const actions: GridAction[] = useMemo(() => {
    if (!round?.q) return [];
    const flop = round.flop;
    const node = flop.nodes[round.q.nodeId];
    return node.edges.map((e, i) => {
      const l = labelEdge(flop, node.id, i);
      return { kind: KIND[e.kind], tone: edgeTone(l), label: edgeText(l) };
    });
  }, [round, edgeText]);

  const barActions: BarAction[] = useMemo(() => {
    if (!round?.q) return [];
    const node = round.flop.nodes[round.q.nodeId];
    let raise = 0;
    return node.edges.map((e, i) => ({
      ...actions[i],
      to: 0,
      key: e.kind === 0 ? "F" : e.kind === 1 ? "C" : e.kind === 3 ? "A" : raise++ === 0 ? "R" : String(i + 1),
      hint: hintIdx === i ? `${Math.round(round.q!.stats[i].freq * 100)}%` : null,
    }));
  }, [round, actions, hintIdx]);

  if (phase === "summary") return <SessionSummary results={results} onAgain={ses.again} onExit={onExit} />;
  if (phase === "empty")
    return (
      <div className="space-y-4 rounded-card border border-line bg-surface p-5 text-center">
        <p>{index ? t("practice.noSpots") : t("pf.missing")}</p>
        <button type="button" onClick={onExit} className="min-h-tap-lg rounded-control bg-accent px-6 font-bold text-accent-ink">
          {t("common.back")}
        </button>
      </div>
    );

  const asking = phase === "asking";
  const answered = phase === "answered" && answer && round?.q;
  const potLabel = t("practice.pot");
  const rngRoll = round?.q?.roll != null ? Math.floor(round.q.roll * 100) + 1 : null;
  const heroName = round ? seatNames[round.hero] : "";
  const heroCards = round ? ([cardOf(COMBOS[round.combo].c1), cardOf(COMBOS[round.combo].c2)] as [ReturnType<typeof cardOf>, ReturnType<typeof cardOf>]) : null;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-md flex-col gap-3" data-phase={phase} data-testid="session">
      <SessionTopBar results={results} onFinish={ses.finish} />

      {config.timer > 0 && asking && <TimerBar seconds={config.timer} restart={`${round?.q?.nodeId}:${round?.combo}:${results.length}`} />}

      {phase === "loading" || !round || !view ? (
        <Skeleton className="mx-auto aspect-[4/4.3] w-full max-w-md rounded-[2.8rem]" />
      ) : answered ? (
        <PostTableMini board={view.ctx.board} heroCards={heroCards} pot={view.pot} potLabel={potLabel} lastAction={view.last[round.hero]} hero={heroName} />
      ) : (
        <div className="w-full">
          <PostTable
            seats={seatNames}
            hero={round.hero}
            board={view.ctx.board}
            pot={view.pot}
            streetInv={view.streetBets}
            stacks={view.stacks}
            actor={asking ? round.hero : phase === "animating" && shown < round.steps.length && round.steps[shown].actor >= 0 ? round.steps[shown].actor : null}
            lastAction={view.last}
            heroCards={heroCards}
            folded={view.foldedP}
            potLabel={potLabel}
          />
        </div>
      )}

      <div className="mt-auto space-y-2.5 pb-1">
        {phase === "animating" && round && shown < round.steps.length && round.steps[shown].actor >= 0 && (
          <p className="text-center text-sm font-semibold text-muted" role="status">
            {t("practice.opponentActs", { p: seatNames[round.steps[shown].actor] })}
          </p>
        )}
        {asking && round?.q && view && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="font-extrabold">
                {heroName} · {t("practice.yourTurn")}
              </span>
              <span className="text-muted">
                {t(`pf.street.${round.flop.nodes[round.q.nodeId].street}` as never)} · {potLabel} {fmtBB(view.pot)}bb{view.ctx.toCall > 0 ? ` · ${fmtBB(view.ctx.toCall)}bb` : ""}
              </span>
            </div>
            {round.q.roll !== null && (
              <div className="rounded-card border border-accent/60 bg-accent/10 p-3" data-testid="rng-panel">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-bold">{t("practice.rngInstruction")}</span>
                  <span className="rounded-control bg-accent px-2.5 py-1 text-xl font-black text-accent-ink" data-testid="rng-roll" aria-label={t("practice.rngRoll")}>
                    {rngRoll}
                  </span>
                </div>
              </div>
            )}
            <ActionBar
              actions={barActions}
              onChoose={(i) => {
                haptic.tap();
                ses.choose(i);
              }}
              onHint={(i) => {
                haptic.tap();
                ses.showHint(i);
              }}
            />
            <p className="text-center text-xs text-muted">{t("practice.hint")}</p>
          </>
        )}
        {answered && round?.q && answer && (
          <ResultPanel q={round.q} a={{ ...answer, endText: answer.endKey && t(answer.endKey) }} actions={actions} pane={pane} onNext={ses.next} onTogglePane={ses.togglePane} nextLabel={config.kind === "through" && answer.nextNode !== null ? t("common.next") : t("practice.nextHand")} approx={t("pf.approx")} terms={["ev", "evLoss", "equity", "range", "spr"]} />
        )}
        {phase === "handEnd" && round && (
          <div className="rounded-sheet border border-line bg-surface p-4 text-center shadow-xl" data-testid="hand-end">
            <p className="mb-3 font-bold">{round.ended === "fold" ? t("pf.end.fold") : round.ended === "showdown" ? t("pf.end.showdown") : round.ended === "allin" ? t("pf.end.allin") : t("pf.end.pruned")}</p>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the answer buttons this replaces are gone: move focus here instead of losing it (the result is announced by a live region) */}
            <button type="button" onClick={ses.next} autoFocus className="min-h-cta w-full rounded-card bg-accent text-lg font-extrabold text-accent-ink">
              {t("practice.nextHand")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
