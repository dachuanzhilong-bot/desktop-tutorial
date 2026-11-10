"use client";
import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionBar, BarAction } from "@/components/ActionBar";
import { IconFlame, IconX } from "@/components/icons";
import { PokerTable } from "@/components/PokerTable";
import { GridAction, toneFor } from "@/components/RangeGrid";
import { Skeleton } from "@/components/Skeleton";
import { Card, comboCount, matchesFilter, NUM_CLASSES, randomCombo } from "@/lib/poker/hands";
import { buildQuestion, judge, PendingStep, playOutOpponents, Question, shortcutFor, stepsTo } from "@/lib/practice/engine";
import { candidateNodes, pickHand, pickNode } from "@/lib/practice/sampler";
import { Result, sessionStats } from "@/lib/practice/session";
import { srsKey, updateSrs, SrsItem } from "@/lib/practice/srs";
import { useSettings } from "@/lib/settings";
import { sessionIdOf } from "@/lib/util/hooks";
import type { SolutionStore } from "@/lib/solution/loader";
import { actionLabel, applyAction, fmtBB, initialState, spotType, stateAt } from "@/lib/solution/tree";
import { ActionKind, PublicState, Terminal } from "@/lib/solution/types";
import type { SpotType } from "@/lib/solution/types";
import { getRepo } from "@/lib/storage/idb";
import type { Attempt } from "@/lib/storage/types";
import { cryptoRandom, weightedPick } from "@/lib/util/rng";
import { haptic } from "@/lib/util/haptics";
import { AnswerInfo, ResultPanel } from "./ResultPanel";
import type { PostConfig } from "@/components/postflop/PostSession";
import { loadIndex } from "@/lib/postflop/loader";
import { postflopLink } from "@/lib/postflop/link";
import { SessionSummary } from "./Summary";
import type { PracticeConfig } from "./types";

interface Round {
  heroSeat: number;
  hand: number;
  cards: [Card, Card];
  queue: PendingStep[];
  startState: PublicState;
  q: Question | null;
  /** hand mode: where the hand stands when it ends without another decision */
  endedWith: Terminal | -2 | null;
}

type Phase = "loading" | "animating" | "asking" | "answered" | "handEnd" | "summary" | "empty";

const STEP_MS = 520;

/** glossary entries shown with the explanation of a preflop question */
const SPOT_TERM: Partial<Record<SpotType, string>> = { rfi: "rfi", limp: "limp", vsOpen: "3bet", squeeze: "squeeze", vs3bet: "4bet", vsSqueeze: "squeeze", vs4bet: "4bet", vs5bet: "4bet" };
const termsFor = (spot: SpotType) => ["ev", "evLoss", "equity", ...(SPOT_TERM[spot] ? [SPOT_TERM[spot]!] : []), "mixed"];

export function Session({ store, config, onExit, onPostflop }: { store: SolutionStore; config: PracticeConfig; onExit: () => void; onPostflop?: (c: PostConfig) => void }) {
  const { t, settings } = useSettings();
  const reduce = useReducedMotion();
  const m = store.manifest;
  const rnd = cryptoRandom;

  const [phase, setPhase] = useState<Phase>("loading");
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(0);
  const [answer, setAnswer] = useState<(AnswerInfo & { heroAfter: PublicState; nextNode: number | null; term: Terminal | -2 | null }) | null>(null);
  const [postIds, setPostIds] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [pane, setPane] = useState<"result" | "explain">("result");
  const [hintIdx, setHintIdx] = useState<number | null>(null);
  const hintUsed = useRef(false);
  const askedAt = useRef(0);
  const srs = useRef<Map<string, SrsItem>>(new Map());
  const sessionId = useRef("");
  const nodes = useMemo(() => candidateNodes(m, config.filter), [m, config.filter]);

  useEffect(() => {
    loadIndex()
      .then((ix) => setPostIds(ix.scenarios.map((x) => x.id)))
      .catch(() => {});
    getRepo()
      .allSrs()
      .then((all) => {
        srs.current = new Map(all.map((s) => [s.key, s]));
      })
      .catch(() => {});
  }, []);

  // ---------------------------------------------------------------- rounds
  const fixedOrder = useRef<number[]>([]);
  const fixedPos = useRef(0);
  const startSpot = useCallback(async () => {
    setPhase("loading");
    if (config.fixed?.length) {
      // a fixed question list: shuffle once per pass
      if (fixedPos.current >= fixedOrder.current.length) {
        fixedOrder.current = config.fixed.map((_, i) => i).sort(() => rnd() - 0.5);
        fixedPos.current = 0;
      }
      const item = config.fixed[fixedOrder.current[fixedPos.current++]];
      const sol = await store.node(item.nodeId);
      const q = buildQuestion(m, item.nodeId, sol, item.hand, rnd, config.rng);
      setRound({ heroSeat: m.nodes[item.nodeId].actor, hand: item.hand, cards: q.cards, queue: stepsTo(m, item.nodeId), startState: initialState(m), q, endedWith: null });
      setShown(0);
      setAnswer(null);
      setPane("result");
      setPhase("animating");
      return;
    }
    if (!nodes.length) return setPhase("empty");
    for (let tries = 0; tries < 12; tries++) {
      const nodeId = pickNode(m, nodes, config.filter, rnd);
      const sol = await store.node(nodeId);
      const hand = pickHand(sol, nodeId, config.filter, rnd, srs.current, Date.now(), m.id);
      if (sol.weight[hand] < 0.02 || !matchesFilter(hand, config.filter.hands)) continue;
      const q = buildQuestion(m, nodeId, sol, hand, rnd, config.rng);
      setRound({ heroSeat: m.nodes[nodeId].actor, hand, cards: q.cards, queue: stepsTo(m, nodeId), startState: initialState(m), q, endedWith: null });
      setShown(0);
      setAnswer(null);
      setPane("result");
      setPhase("animating");
      return;
    }
    setPhase("empty");
  }, [m, nodes, config, store, rnd]);

  const startHand = useCallback(async () => {
    setPhase("loading");
    const seats = config.filter.seats.length ? config.filter.seats : [0, 1, 2, 3, 4, 5];
    const w = new Float64Array(NUM_CLASSES);
    for (let h = 0; h < NUM_CLASSES; h++) w[h] = matchesFilter(h, config.filter.hands) ? comboCount(h) : 0;
    for (let tries = 0; tries < 10; tries++) {
      const heroSeat = seats[Math.floor(rnd() * seats.length)];
      const hand = weightedPick(w, rnd);
      const cards = randomCombo(hand, rnd);
      const out = await playOutOpponents(store, 0, heroSeat, rnd);
      if (out.heroNode === null) continue;
      const sol = await store.node(out.heroNode);
      const q = { ...buildQuestion(m, out.heroNode, sol, hand, rnd, config.rng), cards };
      setRound({ heroSeat, hand, cards, queue: out.steps, startState: initialState(m), q, endedWith: null });
      setShown(0);
      setAnswer(null);
      setPane("result");
      setPhase("animating");
      return;
    }
    setPhase("empty");
  }, [m, config, store, rnd]);

  const startNew = useCallback(() => (config.mode === "spot" ? startSpot() : startHand()), [config.mode, startSpot, startHand]);

  useEffect(() => {
    // kick off loading the first question when the session mounts (the rest is async)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time start of an async flow
    startNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted session (a new session remounts via key)
  }, []);

  // ---------------------------------------------------------------- animation of the opponents' actions
  useEffect(() => {
    if (phase !== "animating" || !round) return;
    const done = shown >= round.queue.length;
    const id = window.setTimeout(
      () => {
        if (!done) return setShown((s) => s + 1);
        // the opponents have acted: the hero's turn starts now (timer and hint reset)
        if (round.q) {
          askedAt.current = performance.now();
          hintUsed.current = false;
          setHintIdx(null);
        }
        setPhase(round.q ? "asking" : "handEnd");
      },
      done || reduce ? 0 : STEP_MS,
    );
    return () => window.clearTimeout(id);
  }, [phase, shown, round, reduce]);

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

  const choose = useCallback(
    (i: number, timeout = false) => {
      if (phase !== "asking" || !round?.q) return;
      const q = round.q;
      const j = judge(q, i);
      const score = hintUsed.current ? Math.floor(j.score / 2) : j.score;
      const meta = m.nodes[q.nodeId];
      const action = meta.actions[i];
      const before = stateAt(m, q.nodeId);
      const heroAfter = applyAction(before, meta.actor, action);
      const ms = Math.round(performance.now() - askedAt.current);
      let endText: string | null = null;
      let nextNode: number | null = null;
      if (action.child >= 0) nextNode = action.child;
      else endText = action.child === -2 ? t("term.pruned") : t(action.term === Terminal.Fold ? "term.fold" : action.term === Terminal.Flop ? "term.flop" : action.term === Terminal.FlopMulti ? "term.flopMulti" : "term.allin");
      if (j.grade === "best" || j.grade === "correct") haptic.good();
      else haptic.bad();
      setResults((r) => [...r, { grade: j.grade, score, evLoss: j.evLoss }]);
      setAnswer({ j, score, ms, timeout, hint: hintUsed.current, before, endText: config.mode === "hand" ? endText : null, heroAfter, nextNode, term: action.child === -2 ? -2 : action.child < 0 ? action.term : null });
      setPane("result");
      setPhase("answered");
      // persist (local-first)
      const now = Date.now();
      const attempt: Attempt = {
        ts: now,
        sessionId: sessionIdOf(sessionId, "s"),
        mode: config.mode,
        solution: m.id,
        nodeId: q.nodeId,
        hand: q.hand,
        seat: meta.actor,
        spot: spotType(m, q.nodeId),
        chosen: i,
        best: j.bestIndex,
        grade: j.grade,
        evLoss: j.evLoss,
        score,
        ms,
        rng: q.roll !== null,
        timeout,
        hint: hintUsed.current,
      };
      const key = srsKey(m.id, q.nodeId, q.hand);
      const item = updateSrs(srs.current.get(key), q.nodeId, q.hand, j.grade, now, key);
      srs.current.set(key, item);
      const repo = getRepo();
      repo.addAttempt(attempt).catch(() => {});
      repo.putSrs(item).catch(() => {});
    },
    [phase, round, m, config.mode, t],
  );

  // time limit: auto-fold (or the first action) when the clock runs out
  useEffect(() => {
    if (phase !== "asking" || !config.timer || !round?.q) return;
    const id = window.setTimeout(() => {
      const meta = m.nodes[round.q!.nodeId];
      const fold = meta.actions.findIndex((a) => a.kind === ActionKind.Fold);
      choose(fold >= 0 ? fold : 0, true);
    }, config.timer * 1000);
    return () => window.clearTimeout(id);
  }, [phase, config.timer, round, m, choose]);

  // a heads-up flop that exists in the postflop solutions can be played on
  const link = useMemo(() => {
    if (config.mode !== "hand" || !onPostflop || !round) return null;
    if (phase === "answered" && answer && answer.term === Terminal.Flop) return postflopLink(answer.heroAfter, round.heroSeat, round.hand, postIds, config.rng, config.timer);
    if (phase === "handEnd" && round.endedWith === Terminal.Flop && round.queue.length) return postflopLink(round.queue[round.queue.length - 1].after, round.heroSeat, round.hand, postIds, config.rng, config.timer);
    return null;
  }, [config, onPostflop, round, phase, answer, postIds]);

  const next = useCallback(async () => {
    if (link && onPostflop && (phase === "answered" || phase === "handEnd")) {
      onPostflop(link);
      return;
    }
    if (phase === "answered" && answer && round && config.mode === "hand" && answer.nextNode !== null) {
      setPhase("loading");
      const out = await playOutOpponents(store, answer.nextNode, round.heroSeat, rnd);
      let q: Question | null = null;
      if (out.heroNode !== null) {
        const sol = await store.node(out.heroNode);
        q = { ...buildQuestion(m, out.heroNode, sol, round.hand, rnd, config.rng), cards: round.cards };
      }
      setRound({ ...round, queue: out.steps, startState: answer.heroAfter, q, endedWith: out.ended });
      setShown(0);
      setAnswer(null);
      setPane("result");
      setPhase("animating");
      return;
    }
    if (phase === "answered" || phase === "handEnd") startNew();
  }, [phase, answer, round, config, store, m, rnd, startNew, link, onPostflop]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (phase === "asking" && round?.q) {
        const meta = m.nodes[round.q.nodeId];
        let idx = -1;
        if (k === "f") idx = meta.actions.findIndex((a) => a.kind === ActionKind.Fold);
        else if (k === "c") idx = meta.actions.findIndex((a) => a.kind === ActionKind.Call);
        else if (k === "r") idx = meta.actions.findIndex((a) => a.kind === ActionKind.Raise);
        else if (k === "a") idx = meta.actions.findIndex((a) => a.kind === ActionKind.AllIn);
        else if (/^[1-9]$/.test(k)) idx = Number(k) - 1 < meta.actions.length ? Number(k) - 1 : -1;
        if (idx >= 0) {
          e.preventDefault();
          choose(idx);
        }
      } else if (phase === "answered" || phase === "handEnd") {
        if (k === "enter" || k === " " || k === "n" || k === "arrowright") {
          e.preventDefault();
          next();
        } else if (k === "e" || k === "arrowleft") setPane((p) => (p === "result" ? "explain" : "result"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, round, m, choose, next]);

  const stats = sessionStats(results);
  const finish = () => (results.length ? setPhase("summary") : onExit());

  if (phase === "summary")
    return (
      <SessionSummary
        results={results}
        onAgain={() => {
          setResults([]);
          startNew();
        }}
        onExit={onExit}
      />
    );

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
  const rngRoll = round?.q?.roll != null ? Math.floor(round.q.roll * 100) + 1 : null;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-md flex-col gap-3" data-phase={phase} data-testid="session">
      {/* top bar */}
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t("practice.finish")} onClick={finish} data-testid="finish" className="grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-muted">
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
      {config.title && (
        <p className="-mt-1 text-center text-xs font-semibold text-muted" data-testid="session-title">
          {config.title}
        </p>
      )}

      {/* time limit bar */}
      {config.timer > 0 && asking && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="timer" aria-label={t("practice.timer")}>
          <motion.div key={round?.q?.nodeId + ":" + round?.hand + ":" + results.length} className="h-full bg-accent" initial={{ width: "100%" }} animate={{ width: "0%" }} transition={{ duration: config.timer, ease: "linear" }} />
        </div>
      )}

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
            {round.q.roll !== null && (
              <div className="rounded-card border border-accent/60 bg-accent/10 p-3" data-testid="rng-panel">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-bold">{t("practice.rngInstruction")}</span>
                  <span className="rounded-control bg-accent px-2.5 py-1 text-xl font-black text-accent-ink" data-testid="rng-roll" aria-label={t("practice.rngRoll")}>
                    {rngRoll}
                  </span>
                </div>
                <div className="flex h-5 overflow-hidden rounded-full text-[0.65rem] font-bold text-white" aria-hidden>
                  {rngOrderBar(round.q, m.nodes[round.q.nodeId].actions, actions).map((s, i) => (
                    <span key={i} className="seg grid place-items-center" data-k={s.tone} style={{ width: `${s.f * 100}%` }}>
                      {s.f > 0.12 ? `${s.label} ${Math.round(s.f * 100)}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <ActionBar
              actions={barActions}
              onChoose={(i) => {
                haptic.tap();
                choose(i);
              }}
              onHint={(i) => {
                hintUsed.current = true;
                haptic.tap();
                setHintIdx(i);
              }}
            />
            <p className="text-center text-xs text-muted">{t("practice.hint")}</p>
          </>
        )}

        {answered && round?.q && answer && (
          <ResultPanel
            q={round.q}
            a={answer}
            actions={actions}
            pane={pane}
            state={answer.before}
            onNext={next}
            onTogglePane={() => setPane((p) => (p === "result" ? "explain" : "result"))}
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
            <button type="button" onClick={next} autoFocus data-testid="hand-end-next" className="min-h-cta w-full rounded-card bg-accent text-lg font-extrabold text-accent-ink">
              {link ? t("practice.toFlop") : t("practice.nextHand")}
            </button>
          </div>
        )}
      </div>
      <span className="sr-only-live" role="status">
        {settings.lang === "ja" ? "" : ""}
      </span>
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
