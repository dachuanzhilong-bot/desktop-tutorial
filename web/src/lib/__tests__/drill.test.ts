/**
 * The session state machine (lib/practice/drill.ts, REFACTOR_PLAN 2-2). The expectations are those of the pre-flop
 * screen before the move (components/practice/Session.tsx up to step 2-1, its useState / useEffect code):
 *   - a new round:   phase "animating", nothing on the table yet (shown 0), no answer, the result pane
 *   - the animation: one step per tick; after the last one "asking" (with a question: the clock starts, the hint is
 *                    cleared) or "handEnd" (without one); outside "animating" nothing happens
 *   - an answer:     only while "asking"; score = judgement score, halved (rounded down) once a hint was looked at;
 *                    ms from the moment of asking; the result is counted; the result pane is shown
 *   - next:          "loading" with the old table kept until the next round is in
 *   - finish:        "summary" when something was answered (the screen leaves otherwise); again: "loading", no results
 */
import { describe, expect, it } from "vitest";
import { drillReducer, hintedScore, initDrill } from "../practice/drill";
import type { AnswerOutcome, DrillAction, DrillState } from "../practice/drill";
import type { Judgement, Question } from "../practice/engine";
import type { Grade } from "../practice/grading";

type Round = { id: string };
type Step = { actor: number };
type Outcome = AnswerOutcome & { extra: string };
type S = DrillState<Round, Step, Outcome>;
type A = DrillAction<Round, Step, Outcome>;

const run = (s: S, ...actions: A[]) => actions.reduce<S>(drillReducer, s);
const question = { nodeId: 7, hand: 0 } as Question;
const judgement = (grade: Grade, score: number, evLoss: number, chosen = 0): Judgement => ({ grade, score, evLoss, bestIndex: 0, chosen, rngMiss: false });
const outcome = (grade: Grade, score: number, evLoss = 0.1): Outcome => ({ j: judgement(grade, score, evLoss), extra: "x" });
const loaded = (steps = 2, q: Question | null = question): A => ({ type: "loaded", round: { id: "r" }, steps: Array.from({ length: steps }, (_, i) => ({ actor: i })), question: q });
const tick = (now = 0): A => ({ type: "tick", now });
const answer = (o: Outcome, now: number, timeout = false, choice = 0): A => ({ type: "answer", choice, outcome: o, timeout, now });
/** a round with two steps played out and asked at `askedAt` */
const asked = (askedAt = 1000) => run(initDrill(), loaded(2), tick(), tick(), tick(askedAt));

describe("drill session: phases", () => {
  it("starts loading, with nothing on the table", () => {
    const s = initDrill<Round, Step, Outcome>();
    expect(s.phase).toBe("loading");
    expect(s.round).toBeNull();
    expect(s.results).toEqual([]);
    expect(s.pane).toBe("result");
  });

  it("a loaded round animates from the first step, with the previous answer and pane cleared", () => {
    const before = run(asked(), answer(outcome("best", 100), 2000), { type: "pane" }, { type: "load" });
    expect(before.pane).toBe("explain");
    const s = run(before, loaded(3));
    expect(s.phase).toBe("animating");
    expect(s.shown).toBe(0);
    expect(s.answer).toBeNull();
    expect(s.pane).toBe("result");
    expect(s.steps).toHaveLength(3);
    expect(s.results).toHaveLength(1);
  });

  it("each tick shows one more step; after the last the hero is asked and the clock starts", () => {
    let s = run(initDrill(), loaded(2));
    s = run(s, tick(10));
    expect([s.phase, s.shown]).toEqual(["animating", 1]);
    s = run(s, tick(20));
    expect([s.phase, s.shown]).toEqual(["animating", 2]);
    s = run(s, tick(1234));
    expect(s.phase).toBe("asking");
    expect(s.shown).toBe(2);
    expect(s.askedAt).toBe(1234);
  });

  it("a round without a question ends the hand after its steps (no clock)", () => {
    const s = run(initDrill(), loaded(1, null), tick(5), tick(99));
    expect(s.phase).toBe("handEnd");
    expect(s.askedAt).toBe(0);
  });

  it("a round with no steps asks on the first tick", () => {
    expect(run(initDrill(), loaded(0), tick(7)).phase).toBe("asking");
  });

  it("ticks do nothing outside the animation", () => {
    const a = asked(1000);
    expect(run(a, tick(5000))).toBe(a);
    const l = initDrill<Round, Step, Outcome>();
    expect(run(l, tick())).toBe(l);
  });

  it("no round to deal: empty", () => {
    expect(run(initDrill(), { type: "empty" }).phase).toBe("empty");
  });
});

describe("drill session: answers", () => {
  it("an answer settles the score, the time taken and the result", () => {
    const s = run(asked(1000), answer(outcome("correct", 92, 0.03), 3499.6));
    expect(s.phase).toBe("answered");
    expect(s.answer).toEqual({ j: judgement("correct", 92, 0.03), extra: "x", score: 92, ms: 2500, timeout: false, hint: false });
    expect(s.results).toEqual([{ grade: "correct", score: 92, evLoss: 0.03 }]);
    expect(s.pane).toBe("result");
  });

  it("a hint halves the score (rounded down) and is noted with the answer", () => {
    let s = run(asked(), { type: "hint", index: 2 });
    expect(s.hint).toEqual({ used: true, index: 2 });
    s = run(s, answer(outcome("best", 75), 2000));
    expect(s.answer!.score).toBe(37);
    expect(s.answer!.hint).toBe(true);
    expect(s.results[0].score).toBe(37);
    expect(hintedScore(100, true)).toBe(50);
    expect(hintedScore(1, true)).toBe(0);
    expect(hintedScore(75, false)).toBe(75);
  });

  it("the hint belongs to one question: the next question starts without it", () => {
    let s = run(asked(), { type: "hint", index: 1 }, answer(outcome("best", 100), 2000), { type: "load" }, loaded(0));
    expect(s.hint.used).toBe(true); // still the previous question's while its steps play
    s = run(s, tick(3000));
    expect(s.hint).toEqual({ used: false, index: null });
    s = run(s, answer(outcome("best", 100), 4000));
    expect(s.answer!.score).toBe(100);
  });

  it("a hint is only taken while asking", () => {
    const s = run(initDrill(), loaded(2), { type: "hint", index: 0 });
    expect(s.hint.used).toBe(false);
  });

  it("the time limit answers: marked as a timeout and counted like any answer", () => {
    const s = run(asked(0), answer(outcome("blunder", 0, 1.5), 5000, true));
    expect(s.phase).toBe("answered");
    expect(s.answer!.timeout).toBe(true);
    expect(s.answer!.ms).toBe(5000);
    expect(s.results).toEqual([{ grade: "blunder", score: 0, evLoss: 1.5 }]);
  });

  it("answers are taken only while asking: not twice, not during the animation or loading", () => {
    const once = run(asked(), answer(outcome("best", 100), 2000));
    expect(run(once, answer(outcome("blunder", 0), 2100))).toBe(once);
    const anim = run(initDrill(), loaded(2));
    expect(run(anim, answer(outcome("best", 100), 0))).toBe(anim);
    const loading = run(once, { type: "load" });
    expect(run(loading, answer(outcome("best", 100), 0))).toBe(loading);
  });

  it("answered never goes back to asking: only a new round does", () => {
    const s = run(asked(), answer(outcome("best", 100), 2000), tick(9999), { type: "hint", index: 0 });
    expect(s.phase).toBe("answered");
  });
});

describe("drill session: going on and finishing", () => {
  it("next: loading, with the round kept until the next one is in", () => {
    const a = run(asked(), answer(outcome("best", 100), 2000));
    const s = run(a, { type: "load" });
    expect(s.phase).toBe("loading");
    expect(s.round).toBe(a.round);
    expect(s.answer).toBe(a.answer);
  });

  it("the pane switches between the result and the explanation", () => {
    const a = run(asked(), answer(outcome("best", 100), 2000));
    expect(run(a, { type: "pane" }).pane).toBe("explain");
    expect(run(a, { type: "pane" }, { type: "pane" }).pane).toBe("result");
  });

  it("finish shows the summary once something was answered; otherwise the state stays (the screen leaves)", () => {
    const a = run(asked(), answer(outcome("mistake", 40, 0.4), 2000));
    expect(run(a, { type: "finish" }).phase).toBe("summary");
    const none = asked();
    expect(run(none, { type: "finish" })).toBe(none);
  });

  it("again from the summary: loading, with the results cleared", () => {
    const s = run(asked(), answer(outcome("best", 100), 2000), { type: "finish" }, { type: "again" });
    expect(s.phase).toBe("loading");
    expect(s.results).toEqual([]);
  });

  it("results add up over a session", () => {
    let s = asked();
    for (let i = 0; i < 3; i++) s = run(s, answer(outcome(i === 1 ? "blunder" : "best", i === 1 ? 0 : 100, i === 1 ? 2 : 0), 2000 + i), { type: "load" }, loaded(0), tick(3000 + i));
    expect(s.results.map((r) => r.grade)).toEqual(["best", "blunder", "best"]);
  });
});
