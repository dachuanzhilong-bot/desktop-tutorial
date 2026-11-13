"use client";
/**
 * A practice session as a hook (REFACTOR_PLAN 2-2): the state machine of lib/practice/drill.ts run with useReducer,
 * plus everything that happens over time or from outside: dealing (the adapter's async start / next), the animation
 * of the steps, the time limit, the keyboard, the sound of an answer and its saving. The game is the adapter.
 *
 * Every action goes through `send`, which also runs the reducer on `live` (a ref): event handlers, timers and the
 * key listener read the state there, so they see an answer the moment it is given (a second key press in the same
 * frame is not a second answer) and never need to re-subscribe.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { haptic } from "../util/haptics";
import { useLatest } from "../util/hooks";
import { drillReducer, initDrill } from "./drill";
import type { AnswerOutcome, DrillAction, DrillAdapter, DrillState } from "./drill";

export type { DrillAdapter } from "./drill";

export interface DrillOptions<Round, Step, O extends AnswerOutcome> {
  /** seconds per decision, 0 = off; when it runs out the adapter's `timeout` answer is given */
  timer: number;
  /** milliseconds per step of the animation */
  stepMs: number;
  /** play the steps at once */
  reduceMotion: boolean;
  /** "finish" with no answers given leaves at once */
  onExit: () => void;
  /** asked before going on from an answer or the end of a hand: true when the screen took over (e.g. on to the flop) */
  handOff?: (state: DrillState<Round, Step, O>) => boolean;
}

const NEXT_KEYS = new Set(["enter", " ", "n", "arrowright"]);
const PANE_KEYS = new Set(["e", "arrowleft"]);

export function useDrillSession<Round, Step, O extends AnswerOutcome>(adapter: DrillAdapter<Round, Step, O>, opts: DrillOptions<Round, Step, O>) {
  const [state, dispatch] = useReducer(drillReducer<Round, Step, O>, undefined, initDrill<Round, Step, O>);
  const live = useRef<DrillState<Round, Step, O>>(state);
  const ad = useLatest(adapter);
  const op = useLatest(opts);

  const send = useCallback((a: DrillAction<Round, Step, O>) => {
    live.current = drillReducer(live.current, a);
    dispatch(a);
    return live.current;
  }, []);

  /** wait for a round and put it on the table (or "empty") */
  const deal = useCallback(
    async (get: () => Promise<Round | null>) => {
      const round = await get();
      if (!round) send({ type: "empty" });
      else send({ type: "loaded", round, steps: ad.current.steps(round), question: ad.current.question(round) });
    },
    [send, ad],
  );

  // the first question, when the session mounts (a new session remounts via key)
  useEffect(() => {
    void deal(() => ad.current.start());
  }, [deal, ad]);

  // the animation of the steps, then the question (or the end of the hand)
  const { phase, shown, steps, round, question } = state;
  const { timer, stepMs, reduceMotion } = opts;
  useEffect(() => {
    if (phase !== "animating" || !round) return;
    const done = shown >= steps.length;
    const id = window.setTimeout(() => send({ type: "tick", now: performance.now() }), done || reduceMotion ? 0 : stepMs);
    return () => window.clearTimeout(id);
  }, [phase, shown, steps, round, reduceMotion, stepMs, send]);

  const choose = useCallback(
    (choice: number, timeout = false) => {
      const s = live.current;
      if (s.phase !== "asking" || !s.question || !s.round) return;
      const r = s.round;
      const settled = send({ type: "answer", choice, outcome: ad.current.answer(r, choice), timeout, now: performance.now() }).answer!;
      if (settled.j.grade === "best" || settled.j.grade === "correct") haptic.good();
      else haptic.bad();
      ad.current.record(r, settled);
    },
    [send, ad],
  );

  // time limit: the adapter's answer (a fold, …) when the clock runs out
  useEffect(() => {
    if (phase !== "asking" || !timer || !question || !round) return;
    const id = window.setTimeout(() => choose(ad.current.timeout(round), true), timer * 1000);
    return () => window.clearTimeout(id);
  }, [phase, timer, question, round, choose, ad]);

  const next = useCallback(async () => {
    const s = live.current;
    if (s.phase !== "answered" && s.phase !== "handEnd") return;
    if (op.current.handOff?.(s)) return;
    const a = ad.current;
    send({ type: "load" });
    const { round: r, answer } = s;
    if (s.phase === "answered" && r && answer) await deal(async () => (await a.next(r, answer)) ?? a.start());
    else await deal(() => a.start());
  }, [send, deal, ad, op]);

  const showHint = useCallback(
    (index: number) => {
      send({ type: "hint", index });
    },
    [send],
  );
  const togglePane = useCallback(() => {
    send({ type: "pane" });
  }, [send]);
  const finish = useCallback(() => {
    if (live.current.results.length) send({ type: "finish" });
    else op.current.onExit();
  }, [send, op]);
  const again = useCallback(() => {
    send({ type: "again" });
    void deal(() => ad.current.start());
  }, [send, deal, ad]);

  // keyboard: the question's shortcuts while asking; next / switch the pane after an answer or the end of a hand
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const s = live.current;
      if (s.phase === "asking" && s.question && s.round) {
        const keys = ad.current.shortcuts(s.round);
        if (Object.hasOwn(keys, k)) {
          e.preventDefault();
          choose(keys[k]);
        }
      } else if (s.phase === "answered" || s.phase === "handEnd") {
        if (NEXT_KEYS.has(k)) {
          e.preventDefault();
          void next();
        } else if (PANE_KEYS.has(k)) togglePane();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, next, togglePane, ad]);

  return { ...state, choose, showHint, next, togglePane, finish, again };
}
