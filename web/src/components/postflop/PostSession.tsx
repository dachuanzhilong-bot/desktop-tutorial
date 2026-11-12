"use client";
import { motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionBar, BarAction } from "@/components/ActionBar";
import { IconFlame, IconX } from "@/components/icons";
import { AnswerInfo, ResultPanel } from "@/components/practice/ResultPanel";
import { SessionSummary } from "@/components/practice/Summary";
import { GridAction } from "@/components/RangeGrid";
import { Skeleton } from "@/components/Skeleton";
import { edgeTone, useEdgeText } from "@/components/postflop/edge";
import { PostTable, PostTableMini } from "@/components/postflop/PostTable";
import { buildPostQuestion, advance, PEnd, pathSteps, pickCombo, pickSpotNode, PStep, spotCandidates } from "@/lib/postflop/practice";
import { COMBOS, cardOf, classOfCards } from "@/lib/postflop/combos";
import type { PfFlop } from "@/lib/postflop/decode";
import { loadFlop, loadIndex, PfIndex } from "@/lib/postflop/loader";
import { contextAt, labelEdge } from "@/lib/postflop/replay";
import { judge, Question } from "@/lib/practice/engine";
import { Result, sessionStats } from "@/lib/practice/session";
import { answerSrs, postflopRef, withPosition } from "@/lib/practice/position";
import { SrsIndex } from "@/lib/practice/srs";
import { useSettings } from "@/lib/settings";
import { sessionIdOf } from "@/lib/util/hooks";
import { ActionKind } from "@/lib/solution/types";
import { fmtBB, SEATS } from "@/lib/solution/tree";
import type { SpotType } from "@/lib/solution/types";
import { getRepo } from "@/lib/storage/idb";
import type { Attempt } from "@/lib/storage/types";
import { haptic } from "@/lib/util/haptics";
import { cryptoRandom, weightedPick } from "@/lib/util/rng";

export interface PostConfig {
  kind: "spot" | "through";
  scenario: string;
  /** 0 = out of position, 1 = in position, null = random */
  hero: 0 | 1 | null;
  streets: number[];
  rng: boolean;
  timer: number;
  /** restrict to one flop (index), or null for random */
  flop: number | null;
  /** continue a preflop hand: the hero's 169-chart class */
  heroClass?: number;
}

interface Round {
  flop: PfFlop;
  flopIdx: number;
  hero: 0 | 1;
  combo: number;
  steps: PStep[];
  startNode: number;
  q: Question | null;
  ended: PEnd;
  lastNode: number;
}

type Phase = "loading" | "animating" | "asking" | "answered" | "handEnd" | "summary" | "empty";
const STEP_MS = 560;
const KIND = [ActionKind.Fold, ActionKind.Call, ActionKind.Raise, ActionKind.AllIn];
const STREET_SPOT: SpotType[] = ["postFlop", "postTurn", "postRiver"];

export function PostSession({ config, onExit }: { config: PostConfig; onExit: () => void }) {
  const { t } = useSettings();
  const reduce = useReducedMotion();
  const edgeText = useEdgeText();
  const rnd = cryptoRandom;
  const [index, setIndex] = useState<PfIndex | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [round, setRound] = useState<Round | null>(null);
  const [shown, setShown] = useState(0);
  const [answer, setAnswer] = useState<(AnswerInfo & { nextNode: number | null; endText: string | null; chosenEdge: number }) | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [pane, setPane] = useState<"result" | "explain">("result");
  const [hintIdx, setHintIdx] = useState<number | null>(null);
  const hintUsed = useRef(false);
  const askedAt = useRef(0);
  const srs = useRef(new SrsIndex());
  const sessionId = useRef("");

  useEffect(() => {
    getRepo()
      .allSrs()
      .then((all) => (srs.current = new SrsIndex(all)))
      .catch(() => {});
    loadIndex()
      .then(setIndex)
      .catch(() => setPhase("empty"));
  }, []);

  const sc = index?.scenarios.find((s) => s.id === config.scenario);
  const seatNames: [string, string] = sc ? [sc.oop, sc.ip] : ["OOP", "IP"];

  const start = useCallback(async () => {
    if (!index) return;
    setPhase("loading");
    for (let tries = 0; tries < 10; tries++) {
      const flopIdx = config.flop ?? Math.floor(rnd() * index.flops.length);
      const flop = await loadFlop(config.scenario, flopIdx);
      const hero = (config.hero ?? (rnd() < 0.5 ? 0 : 1)) as 0 | 1;
      if (config.kind === "spot") {
        const nodes = spotCandidates(flop, { hero: config.hero === null ? null : hero, streets: config.streets });
        if (!nodes.length) continue;
        const nodeId = pickSpotNode(flop, nodes, 0.5, rnd);
        const node = flop.nodes[nodeId];
        // spaced repetition by position: the item of (scenario, flop + line, combo); an older item by its old key
        const ref = postflopRef(config.scenario, flop, nodeId);
        const combo = pickCombo(node, rnd, (c) => srs.current.find(ref.solution, ref.pos, c), Date.now());
        const q = buildPostQuestion(flop, nodeId, combo, rnd, config.rng);
        setRound({ flop, flopIdx, hero: node.actor as 0 | 1, combo, steps: pathSteps(flop, nodeId), startNode: 0, q, ended: null, lastNode: nodeId });
      } else {
        // hero's hand from the range at the hero's first decision
        const first = flop.nodes.find((n) => n.type === "decision" && n.actor === hero && n.street === 0 && n.data)!;
        const board = flop.board;
        const hands = first.data!.hands;
        const w = new Float64Array(hands.length);
        for (let j = 0; j < hands.length; j++) {
          const c = COMBOS[hands[j]];
          // a continued preflop hand keeps its chart class; hands that collide with the board are impossible
          const okClass = config.heroClass === undefined || classOfCards(c.c1, c.c2) === config.heroClass;
          w[j] = okClass && !board.includes(c.c1) && !board.includes(c.c2) ? first.data!.weight[j] : 0;
        }
        const jPick = w.some((x) => x > 0) ? weightedPick(w, rnd) : weightedPick(first.data!.weight, rnd);
        const combo = hands[jPick];
        const used = [...board, COMBOS[combo].c1, COMBOS[combo].c2];
        const out = advance(flop, 0, hero, used, combo, rnd);
        const q = out.heroNode !== null ? buildPostQuestion(flop, out.heroNode, combo, rnd, config.rng) : null;
        setRound({ flop, flopIdx, hero, combo, steps: out.steps, startNode: 0, q, ended: out.ended, lastNode: out.lastNode });
      }
      setShown(0);
      setAnswer(null);
      setPane("result");
      setPhase("animating");
      return;
    }
    setPhase("empty");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, config]);

  useEffect(() => {
    // the first hand starts as soon as the flop index has loaded
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start of an async flow once its data exists
    if (index) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per loaded index
  }, [index]);

  // animation of the opponent's moves and the dealt cards
  useEffect(() => {
    if (phase !== "animating" || !round) return;
    const done = shown >= round.steps.length;
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

  // what the table shows right now
  const view = useMemo(() => {
    if (!round) return null;
    const { flop } = round;
    const heroNode = round.q?.nodeId ?? round.lastNode;
    let nodeId = 0;
    if (shown > 0) {
      const s = round.steps[shown - 1];
      nodeId = s.toNode >= 0 ? s.toNode : s.nodeId;
    }
    if (phase === "asking" || phase === "answered") nodeId = heroNode;
    const ctx = contextAt(flop, nodeId);
    const node = flop.nodes[nodeId];
    const last: (string | null)[] = [null, null];
    let streetBets: [number, number] = ctx.streetInv;
    let foldedP: number | null = null;
    for (let i = 0; i < Math.min(shown, round.steps.length); i++) {
      const s = round.steps[i];
      if (s.card !== null) {
        last[0] = null;
        last[1] = null;
      } else if (s.label) {
        last[s.actor] = edgeText(s.label);
        if (s.label.key === "fold") foldedP = s.actor;
      }
    }
    // the move that just ended the hand is not part of a node's context
    if (shown > 0 && round.steps[shown - 1].toNode < 0 && round.steps[shown - 1].label) {
      const s = round.steps[shown - 1];
      const bump = streetBets.slice() as [number, number];
      const n = flop.nodes[s.nodeId];
      const e = n.edges[s.edgeIndex];
      if (e.kind !== 0) bump[s.actor] = e.amount;
      streetBets = bump;
    }
    if (phase === "answered" && answer && round.q) {
      const n = flop.nodes[round.q.nodeId];
      const e = n.edges[answer.chosenEdge];
      last[n.actor] = edgeText(labelEdge(flop, n.id, answer.chosenEdge));
      if (e.kind === 0) foldedP = n.actor;
      else {
        const bump = streetBets.slice() as [number, number];
        bump[n.actor] = e.amount;
        streetBets = bump;
      }
    }
    const extra = streetBets[0] - ctx.streetInv[0] + (streetBets[1] - ctx.streetInv[1]);
    return { ctx, node, last, streetBets, foldedP, pot: ctx.pot + extra, nodeId };
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

  const choose = useCallback(
    (i: number, timeout = false) => {
      if (phase !== "asking" || !round?.q || !sc) return;
      const q = round.q;
      const j = judge(q, i);
      const score = hintUsed.current ? Math.floor(j.score / 2) : j.score;
      const node = round.flop.nodes[q.nodeId];
      const edge = node.edges[i];
      const ms = Math.round(performance.now() - askedAt.current);
      const endText = edge.code === -1 ? t("pf.end.fold") : edge.code === -3 ? t("pf.end.showdown") : edge.code === -4 ? t("pf.end.allin") : edge.code === -2 ? t("pf.end.pruned") : null;
      if (j.grade === "best" || j.grade === "correct") haptic.good();
      else haptic.bad();
      setResults((r) => [...r, { grade: j.grade, score, evLoss: j.evLoss }]);
      setAnswer({ j, score, ms, timeout, hint: hintUsed.current, before: undefined as never, endText: config.kind === "through" ? endText : null, nextNode: edge.code >= 0 ? edge.code : null, chosenEdge: i });
      setPane("result");
      setPhase("answered");
      const now = Date.now();
      const seatName = node.actor === 0 ? sc.oop : sc.ip;
      // the flop's board, the line and the build ID: what the record is found by after the data is generated again
      // (the flop's index and the node id are not: `solution` has no index, `nodeId` is only informative)
      const ref = postflopRef(config.scenario, round.flop, q.nodeId);
      const attempt = withPosition<Omit<Attempt, "pos" | "build">>({
        ts: now,
        sessionId: sessionIdOf(sessionId, "p"),
        mode: config.kind === "spot" ? "postSpot" : "post",
        solution: ref.solution,
        nodeId: q.nodeId,
        hand: round.combo,
        seat: Math.max(0, SEATS.indexOf(seatName as (typeof SEATS)[number])),
        spot: STREET_SPOT[node.street],
        chosen: i,
        best: j.bestIndex,
        grade: j.grade,
        evLoss: j.evLoss,
        score,
        ms,
        rng: q.roll !== null,
        timeout,
        hint: hintUsed.current,
      }, ref);
      const item = answerSrs(srs.current, ref, q.nodeId, round.combo, j.grade, now);
      const repo = getRepo();
      repo.addAttempt(attempt).catch(() => {});
      repo.putSrs(item).catch(() => {});
    },
    [phase, round, sc, config, t],
  );

  useEffect(() => {
    if (phase !== "asking" || !config.timer || !round?.q) return;
    const id = window.setTimeout(() => {
      const node = round.flop.nodes[round.q!.nodeId];
      const fold = node.edges.findIndex((e) => e.kind === 0);
      const chk = node.edges.findIndex((e) => e.kind === 1);
      choose(fold >= 0 ? fold : chk >= 0 ? chk : 0, true);
    }, config.timer * 1000);
    return () => window.clearTimeout(id);
  }, [phase, config.timer, round, choose]);

  const next = useCallback(() => {
    if (phase === "answered" && answer && round && config.kind === "through" && answer.nextNode !== null) {
      const heroCards = [COMBOS[round.combo].c1, COMBOS[round.combo].c2];
      // the board so far (cards already dealt) must not be redealt
      const ctx = contextAt(round.flop, answer.nextNode);
      const out = advance(round.flop, answer.nextNode, round.hero, [...ctx.board, ...heroCards], round.combo, rnd);
      const q = out.heroNode !== null ? buildPostQuestion(round.flop, out.heroNode, round.combo, rnd, config.rng) : null;
      setRound({ ...round, steps: out.steps, startNode: answer.nextNode, q, ended: out.ended, lastNode: out.lastNode });
      setShown(0);
      setAnswer(null);
      setPane("result");
      setPhase("animating");
      return;
    }
    if (phase === "answered" || phase === "handEnd") start();
  }, [phase, answer, round, config, start, rnd]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (phase === "asking" && round?.q) {
        const node = round.flop.nodes[round.q.nodeId];
        let idx = -1;
        if (k === "f") idx = node.edges.findIndex((x) => x.kind === 0);
        else if (k === "c") idx = node.edges.findIndex((x) => x.kind === 1);
        else if (k === "r") idx = node.edges.findIndex((x) => x.kind === 2);
        else if (k === "a") idx = node.edges.findIndex((x) => x.kind === 3);
        else if (/^[1-9]$/.test(k)) idx = Number(k) - 1 < node.edges.length ? Number(k) - 1 : -1;
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
  }, [phase, round, choose, next]);

  const stats = sessionStats(results);
  const finish = () => (results.length ? setPhase("summary") : onExit());

  if (phase === "summary")
    return (
      <SessionSummary
        results={results}
        onAgain={() => {
          setResults([]);
          start();
        }}
        onExit={onExit}
      />
    );
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
  const stacks: [number, number] = view && round ? [round.flop.stack - view.node.inv[0] - view.streetBets[0] + view.ctx.streetInv[0], round.flop.stack - view.node.inv[1] - view.streetBets[1] + view.ctx.streetInv[1]] : [0, 0];

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-2rem)] max-w-md flex-col gap-3" data-phase={phase} data-testid="session">
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

      {config.timer > 0 && asking && (
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="timer" aria-label={t("practice.timer")}>
          <motion.div key={`${round?.q?.nodeId}:${round?.combo}:${results.length}`} className="h-full bg-accent" initial={{ width: "100%" }} animate={{ width: "0%" }} transition={{ duration: config.timer, ease: "linear" }} />
        </div>
      )}

      {phase === "loading" || !round || !view ? (
        <Skeleton className="mx-auto aspect-[4/4.3] w-full max-w-md rounded-[2.8rem]" />
      ) : (
        answered ? (
          <PostTableMini board={view.ctx.board} heroCards={heroCards} pot={view.pot} potLabel={potLabel} lastAction={view.last[round.hero]} hero={heroName} />
        ) : (
          <div className="w-full">
            <PostTable
              seats={seatNames}
              hero={round.hero}
              board={view.ctx.board}
              pot={view.pot}
              streetInv={view.streetBets}
              stacks={stacks}
              actor={asking ? round.hero : phase === "animating" && shown < round.steps.length && round.steps[shown].actor >= 0 ? round.steps[shown].actor : null}
              lastAction={view.last}
              heroCards={heroCards}
              folded={view.foldedP}
              potLabel={potLabel}
            />
          </div>
        )
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
          <ResultPanel q={round.q} a={answer as AnswerInfo} actions={actions} pane={pane} state={undefined as never} onNext={next} onTogglePane={() => setPane((p) => (p === "result" ? "explain" : "result"))} nextLabel={config.kind === "through" && answer.nextNode !== null ? t("common.next") : t("practice.nextHand")} approx={t("pf.approx")} terms={["ev", "evLoss", "equity", "range", "spr"]} />
        )}
        {phase === "handEnd" && round && (
          <div className="rounded-sheet border border-line bg-surface p-4 text-center shadow-xl" data-testid="hand-end">
            <p className="mb-3 font-bold">{round.ended === "fold" ? t("pf.end.fold") : round.ended === "showdown" ? t("pf.end.showdown") : round.ended === "allin" ? t("pf.end.allin") : t("pf.end.pruned")}</p>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the answer buttons this replaces are gone: move focus here instead of losing it (the result is announced by a live region) */}
            <button type="button" onClick={next} autoFocus className="min-h-cta w-full rounded-card bg-accent text-lg font-extrabold text-accent-ink">
              {t("practice.nextHand")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
