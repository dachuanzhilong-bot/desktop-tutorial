"use client";
import { useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ActionBar, BarAction } from "@/components/ActionBar";
import { PokerTable } from "@/components/PokerTable";
import { GridAction, toneFor } from "@/components/RangeGrid";
import { Skeleton } from "@/components/Skeleton";
import { PendingStep, shortcutFor } from "@/lib/practice/engine";
import type { DrillState } from "@/lib/practice/drill";
import { createPreflopDrill } from "@/lib/practice/preflopDrill";
import type { PreflopOutcome, PreflopRound } from "@/lib/practice/preflopDrill";
import { useDrillSession } from "@/lib/practice/useDrillSession";
import { useSettings } from "@/lib/settings";
import type { SolutionStore } from "@/lib/solution/loader";
import { actionLabel, fmtBB, initialState, spotType, stateAt } from "@/lib/solution/tree";
import { ActionKind, PublicState, Terminal } from "@/lib/solution/types";
import type { SpotType } from "@/lib/solution/types";
import type { Repo } from "@/lib/storage/types";
import { cryptoRandom } from "@/lib/util/rng";
import { haptic } from "@/lib/util/haptics";
import { ResultPanel } from "./ResultPanel";
import type { PostConfig } from "@/lib/postflop/types";
import { loadIndex } from "@/lib/postflop/loader";
import type { PfScenario } from "@/lib/postflop/loader";
import { postflopLink } from "@/lib/postflop/link";
import { RngPanel, SessionTopBar, TimerBar } from "./SessionParts";
import { SessionSummary } from "./Summary";
import type { PracticeConfig } from "./types";

const STEP_MS = 520;

/** glossary entries shown with the explanation of a preflop question */
const SPOT_TERM: Partial<Record<SpotType, string>> = { rfi: "rfi", limp: "limp", vsOpen: "3bet", squeeze: "squeeze", vs3bet: "4bet", vsSqueeze: "squeeze", vs4bet: "4bet", vs5bet: "4bet" };
const termsFor = (spot: SpotType) => ["ev", "evLoss", "equity", ...(SPOT_TERM[spot] ? [SPOT_TERM[spot]!] : []), "mixed"];

/** the pre-flop drill: the session (lib/practice/useDrillSession.ts) runs the pre-flop game (lib/practice/preflopDrill.ts); this draws it */
export function Session({ store, repo, config, onExit, onPostflop }: { store: SolutionStore; repo: Repo; config: PracticeConfig; onExit: () => void; onPostflop?: (c: PostConfig) => void }) {
  const { t } = useSettings();
  const reduce = useReducedMotion();
  const m = store.manifest;
  const [drill] = useState(() => createPreflopDrill({ store, repo, config, rnd: cryptoRandom }));
  const [scenarios, setScenarios] = useState<readonly PfScenario[]>([]);

  useEffect(() => {
    loadIndex()
      .then((ix) => setScenarios(ix.scenarios))
      .catch(() => {});
    repo
      .allSrs()
      .then((all) => drill.setSrs(all))
      .catch(() => {});
  }, [repo, drill]);

  // a heads-up flop that exists in the postflop solutions can be played on
  const flopLink = ({ phase, round, answer }: Pick<DrillState<PreflopRound, PendingStep, PreflopOutcome>, "phase" | "round" | "answer">) => {
    if (config.mode !== "hand" || !onPostflop || !round) return null;
    if (phase === "answered" && answer && answer.term === Terminal.Flop && round.q) return postflopLink(m, round.q.nodeId, answer.j.chosen, round.heroSeat, round.hand, scenarios, config.rng, config.timer);
    const last = round.queue[round.queue.length - 1];
    if (phase === "handEnd" && round.endedWith === Terminal.Flop && last) return postflopLink(m, last.node, last.actionIndex, round.heroSeat, round.hand, scenarios, config.rng, config.timer);
    return null;
  };
  const handOff = (st: Parameters<typeof flopLink>[0]) => {
    const l = flopLink(st);
    if (l && onPostflop) onPostflop(l);
    return !!l;
  };
  const ses = useDrillSession(drill, { timer: config.timer, stepMs: STEP_MS, reduceMotion: !!reduce, onExit, handOff });
  const { phase, round, shown, answer, results, pane } = ses;
  const hintIdx = ses.hint.index;
  const link = flopLink(ses);

  const tableState: PublicState = useMemo(() => {
    if (!round) return initialState(m);
    if (phase === "answered" && answer) return answer.heroAfter;
    return shown === 0 ? round.startState : round.queue[shown - 1].after;
  }, [round, shown, phase, answer, m]);
  const lastAction = useMemo(() => {
    const out: (string | null)[] = [null, null, null, null, null, null];
    if (!round) return out;
    for (let i = 0; i < Math.min(shown, round.queue.length); i++) {
      const s = round.queue[i];
      out[s.actor] = actionLabel(s.action, s.actor, s.before, t) + (s.action.kind >= ActionKind.Raise ? ` ${fmtBB(s.action.to)}` : s.action.kind === ActionKind.Call && s.before.level > 0 ? ` ${fmtBB(s.action.to)}` : "");
    }
    if (phase === "answered" && answer && round.q) {
      const meta = m.nodes[round.q.nodeId];
      const a = meta.actions[answer.j.chosen];
      out[meta.actor] = actionLabel(a, meta.actor, answer.before, t) + (a.kind >= ActionKind.Raise ? ` ${fmtBB(a.to)}` : "");
    }
    return out;
  }, [round, shown, phase, answer, m, t]);

  // ---------------------------------------------------------------- the hero's decision
  const actions: GridAction[] = useMemo(() => {
    if (!round?.q) return [];
    const meta = m.nodes[round.q.nodeId];
    const st = stateAt(m, round.q.nodeId);
    return meta.actions.map((a) => ({ kind: a.kind, tone: toneFor(a.kind, st.level), label: actionLabel(a, meta.actor, st, t) }));
  }, [round, m, t]);

  const barActions: BarAction[] = useMemo(() => {
    if (!round?.q) return [];
    const meta = m.nodes[round.q.nodeId];
    let raiseIdx = 0;
    return meta.actions.map((a, i) => ({
      ...actions[i],
      to: a.to,
      key: shortcutFor(a, a.kind === ActionKind.Raise ? raiseIdx++ : 0),
      hint: hintIdx === i ? `${Math.round(round.q!.stats[i].freq * 100)}%` : null,
    }));
  }, [round, actions, m, hintIdx]);

  if (phase === "summary") return <SessionSummary results={results} onAgain={ses.again} onExit={onExit} />;

  if (phase === "empty")
    return (
      <div className="space-y-4 rounded-card border border-line bg-surface p-5 text-center">
        <p>{t("practice.noSpots")}</p>
        <button type="button" onClick={onExit} className="min-h-tap-lg rounded-control bg-accent px-6 font-bold text-accent-ink">
          {t("common.back")}
        </button>
      </div>
    );

  const asking = phase === "asking";
  const answered = phase === "answered" && answer && round?.q;
  const heroName = round ? m.players[round.heroSeat] : "";
  const potLabel = t("practice.pot");
  const toCall = round?.q ? Math.max(0, stateAt(m, round.q.nodeId).cur - stateAt(m, round.q.nodeId).inv[round.heroSeat]) : 0;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-md flex-col gap-3" data-phase={phase} data-testid="session">
      {/* top bar */}
      <SessionTopBar results={results} onFinish={ses.finish} />
      {config.title && (
        <p className="-mt-1 text-center text-xs font-semibold text-muted" data-testid="session-title">
          {config.title}
        </p>
      )}

      {/* time limit bar */}
      {config.timer > 0 && asking && <TimerBar seconds={config.timer} restart={round?.q?.nodeId + ":" + round?.hand + ":" + results.length} />}

      {/* table */}
      {phase === "loading" || !round ? (
        <Skeleton className="mx-auto aspect-[4/3.1] w-full max-w-md rounded-[2.8rem]" />
      ) : (
        <div className={answered ? "mx-auto w-full max-w-[17rem]" : "w-full"}>
          <PokerTable
            seats={m.players}
            hero={round.heroSeat}
            state={tableState}
            stack={m.stack}
            actor={asking ? round.heroSeat : phase === "animating" && shown < round.queue.length ? round.queue[shown].actor : null}
            lastAction={lastAction}
            heroCards={round.cards}
            potLabel={potLabel}
          />
        </div>
      )}

      {/* bottom area */}
      <div className="mt-auto space-y-2.5 pb-1">
        {phase === "animating" && round && shown < round.queue.length && (
          <p className="text-center text-sm font-semibold text-muted" role="status">
            {t("practice.opponentActs", { p: m.players[round.queue[shown].actor] })}
          </p>
        )}

        {asking && round?.q && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="font-extrabold">
                {heroName} · {t("practice.yourTurn")}
              </span>
              <span className="text-muted">
                {potLabel} {fmtBB(tableState.pot)}bb{toCall > 0 ? ` · ${fmtBB(toCall)}bb` : ""}
              </span>
            </div>
            {round.q.roll !== null && <RngPanel q={round.q} metaActions={m.nodes[round.q.nodeId].actions} actions={actions} />}
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
          <ResultPanel
            q={round.q}
            a={{ ...answer, endText: answer.endKey && t(answer.endKey) }}
            actions={actions}
            pane={pane}
            onNext={ses.next}
            onTogglePane={ses.togglePane}
            nextLabel={link ? t("practice.toFlop") : config.mode === "hand" && answer.nextNode !== null ? t("common.next") : t("practice.nextHand")}
            approx={t("approx.grading", { depth: m.stack })}
            terms={termsFor(spotType(m, round.q.nodeId))}
          />
        )}

        {phase === "handEnd" && round && (
          <div className="rounded-sheet border border-line bg-surface p-4 text-center shadow-xl" data-testid="hand-end">
            <p className="mb-3 font-bold">
              {round.endedWith === Terminal.Fold ? t("term.fold") : round.endedWith === Terminal.Flop ? t("term.flop") : round.endedWith === Terminal.FlopMulti ? t("term.flopMulti") : round.endedWith === Terminal.AllIn ? t("term.allin") : t("term.pruned")}
            </p>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the answer buttons this replaces are gone: move focus here instead of losing it (the result is announced by a live region) */}
            <button type="button" onClick={ses.next} autoFocus data-testid="hand-end-next" className="min-h-cta w-full rounded-card bg-accent text-lg font-extrabold text-accent-ink">
              {link ? t("practice.toFlop") : t("practice.nextHand")}
            </button>
          </div>
        )}
      </div>
      <span className="sr-only-live" role="status" />
    </div>
  );
}
