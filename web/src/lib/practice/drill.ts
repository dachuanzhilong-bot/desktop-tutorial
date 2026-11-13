/**
 * The state machine of a practice session (REFACTOR_PLAN step 2-2), without React and without any game in it:
 * the pre-flop drill (components/practice/Session.tsx) runs on it through lib/practice/useDrillSession.ts, and the
 * post-flop drill is meant to follow (step 2-3). What a round, a step of the animation and the details of an answer
 * are is the game's business (the adapter in useDrillSession.ts); here they are type parameters.
 *
 *   loading ──loaded──▶ animating ──tick (one per step)──▶ … ──tick──▶ asking   (the round has a question)
 *      ▲                                                        └─tick──▶ handEnd  (it has none: the hand ended)
 *      │                asking ──answer (a click, a key or the time limit)──▶ answered
 *      └──load── answered / handEnd   (next: the same hand goes on, or a new one is dealt)
 *   loading ──empty──▶ empty                  any phase with answers ──finish──▶ summary ──again──▶ loading
 *
 * Time comes in with the actions (`now`, milliseconds of one clock), so the reducer is pure and tests fix it.
 */
import type { Judgement, Question } from "./engine";
import type { Result } from "./session";

export type DrillPhase = "loading" | "animating" | "asking" | "answered" | "handEnd" | "summary" | "empty";
export type DrillPane = "result" | "explain";

/** what the reducer needs from the game's answer: the judgement; the rest goes along untouched */
export interface AnswerOutcome {
  j: Judgement;
}

/** an answer as the session settled it: the game's outcome plus the score after the hint penalty and the time taken */
export type Answered<O extends AnswerOutcome> = O & {
  /** after the hint penalty (half, rounded down) */
  score: number;
  /** from the moment the question was asked */
  ms: number;
  /** answered by the time limit */
  timeout: boolean;
  /** a hint was looked at before answering */
  hint: boolean;
};

export interface DrillState<Round, Step, O extends AnswerOutcome> {
  phase: DrillPhase;
  round: Round | null;
  /** the steps the table plays before the question (the adapter's `steps(round)`) */
  steps: Step[];
  /** the hero's question at the end of the steps, or null when the hand ends there */
  question: Question | null;
  /** how many steps are on the table */
  shown: number;
  answer: Answered<O> | null;
  results: Result[];
  pane: DrillPane;
  /** the hint of this question: whether one was looked at (halves the score) and which action shows its frequency */
  hint: { used: boolean; index: number | null };
  /** when the question was asked (the clock of the actions' `now`) */
  askedAt: number;
}

export type DrillAction<Round, Step, O extends AnswerOutcome> =
  | { type: "load" }
  | { type: "loaded"; round: Round; steps: Step[]; question: Question | null }
  | { type: "empty" }
  | { type: "tick"; now: number }
  | { type: "hint"; index: number }
  | { type: "answer"; choice: number; outcome: O; timeout: boolean; now: number }
  | { type: "pane" }
  | { type: "finish" }
  | { type: "again" };

/**
 * What a game gives the session (REFACTOR_PLAN 2-2). Beyond the plan's six members: `timeout` (the answer the time
 * limit gives, which differs by game) and `record` (saving the answer, which needs the score after the hint penalty and
 * the time taken, known only once the session has settled the answer). `next` gets that settled answer as well.
 */
export interface DrillAdapter<Round, Step, O extends AnswerOutcome> {
  /** the next question (a new hand), or null when none can be found ("empty") */
  start(): Promise<Round | null>;
  /** the steps the table plays before the question */
  steps(round: Round): Step[];
  /** the hero's question at the end of the steps, or null when the hand ends there */
  question(round: Round): Question | null;
  /** grade an answer and work out where it leads (pure: no saving, no sound) */
  answer(round: Round, choice: number): O;
  /** the same hand goes on after this answer, or null to deal a new one */
  next(round: Round, answer: Answered<O>): Promise<Round | null>;
  /** keyboard key (lower case, as KeyboardEvent.key) -> action index of the question */
  shortcuts(round: Round): Record<string, number>;
  /** the action the time limit answers with */
  timeout(round: Round): number;
  /** save the settled answer (the screen does not wait for it) */
  record(round: Round, answer: Answered<O>): void;
}

export function initDrill<Round, Step, O extends AnswerOutcome>(): DrillState<Round, Step, O> {
  return { phase: "loading", round: null, steps: [], question: null, shown: 0, answer: null, results: [], pane: "result", hint: { used: false, index: null }, askedAt: 0 };
}

/** the score an answer keeps: half (rounded down) once a hint was looked at */
export const hintedScore = (score: number, hint: boolean) => (hint ? Math.floor(score / 2) : score);

export function drillReducer<Round, Step, O extends AnswerOutcome>(s: DrillState<Round, Step, O>, a: DrillAction<Round, Step, O>): DrillState<Round, Step, O> {
  switch (a.type) {
    case "load":
      // the table stays as it was (it shows a skeleton while loading) until the next round is in
      return { ...s, phase: "loading" };
    case "loaded":
      return { ...s, phase: "animating", round: a.round, steps: a.steps, question: a.question, shown: 0, answer: null, pane: "result" };
    case "empty":
      return { ...s, phase: "empty" };
    case "tick":
      if (s.phase !== "animating") return s;
      if (s.shown < s.steps.length) return { ...s, shown: s.shown + 1 };
      // the opponents have acted: the hero's turn starts now (timer and hint reset)
      if (!s.question) return { ...s, phase: "handEnd" };
      return { ...s, phase: "asking", askedAt: a.now, hint: { used: false, index: null } };
    case "hint":
      if (s.phase !== "asking") return s;
      return { ...s, hint: { used: true, index: a.index } };
    case "answer": {
      if (s.phase !== "asking" || !s.question) return s;
      const { j } = a.outcome;
      const score = hintedScore(j.score, s.hint.used);
      const answer = { ...a.outcome, score, ms: Math.round(a.now - s.askedAt), timeout: a.timeout, hint: s.hint.used };
      return { ...s, phase: "answered", answer, results: [...s.results, { grade: j.grade, score, evLoss: j.evLoss }], pane: "result" };
    }
    case "pane":
      return { ...s, pane: s.pane === "result" ? "explain" : "result" };
    case "finish":
      // with no answers the screen leaves the session instead (the hook calls onExit)
      return s.results.length ? { ...s, phase: "summary" } : s;
    case "again":
      return { ...s, phase: "loading", results: [] };
  }
}
