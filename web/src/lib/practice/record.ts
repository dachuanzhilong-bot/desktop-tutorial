/**
 * Saving an answer of a practice question (REFACTOR_PLAN step 2-1): the one place that makes the record of an answer
 * (Attempt), updates spaced repetition (SrsItem) and writes both. Pre-flop (components/practice/Session.tsx) and
 * post-flop (components/postflop/PostSession.tsx) both call it.
 *
 * What it writes is exactly what the two screens wrote before (record.test.ts compares them field by field):
 *   pre-flop   solution `cash6max-<depth>bb`, `pos` the action line, `build` SolutionStore.build,
 *              seat = the actor of the node, spot = spotType(manifest, node)
 *   post-flop  solution `post:<scenario>`, `pos` `<flop>@<line>`, `build` the flop file's,
 *              seat = the seat of the scenario's player who acts (OOP / IP), spot = postFlop / postTurn / postRiver
 *
 * Order: the in-memory SrsIndex is updated before this returns (synchronously: the next question must see it),
 * then the Attempt write and the SrsItem write are started, in that order, once each. The promise settles when both
 * are written; the screens do not wait for it.
 */
import type { PfFlop } from "../postflop/decode";
import { SEATS, spotType } from "../solution/tree";
import type { Manifest, SpotType } from "../solution/types";
import type { Attempt, Repo } from "../storage/types";
import type { Grade } from "./grading";
import { answerSrs, postflopRef, preflopRef, withPosition } from "./position";
import type { PositionRef } from "./position";
import type { SrsIndex, SrsItem } from "./srs";

/** what every answer has, whichever game it is */
interface AnswerBase {
  /** this device's spaced-repetition items: updated in place */
  srs: SrsIndex;
  sessionId: string;
  /** decision node of the question in the data it was asked from (informative in the record) */
  nodeId: number;
  /** pre-flop: hand class (0..168); post-flop: combo (0..1325) */
  hand: number;
  chosen: number;
  best: number;
  grade: Grade;
  evLoss: number;
  /** after the hint penalty */
  score: number;
  ms: number;
  /** the question had a random number (RNG mode) */
  rng: boolean;
  timeout: boolean;
  hint: boolean;
  /** epoch ms of the answer: `ts` of the record and the clock of spaced repetition */
  now: number;
}

export interface PreflopAnswer extends AnswerBase {
  game: "preflop";
  mode: "spot" | "hand";
  manifest: Manifest;
  /** SolutionStore.build ("" or undefined: the record has no `build`) */
  build: string | undefined;
}

export interface PostflopAnswer extends AnswerBase {
  game: "postflop";
  mode: "postSpot" | "post";
  /** the scenario (its id and the seat names of the two players) */
  scenario: { id: string; oop: string; ip: string };
  /** the flop as loaded (its build ID is PfFlop.build) */
  flop: PfFlop;
}

export type AnswerInput = PreflopAnswer | PostflopAnswer;

const STREET_SPOT: SpotType[] = ["postFlop", "postTurn", "postRiver"];

/** where the answer belongs and the fields that depend on the game */
function placeOf(input: AnswerInput): { ref: PositionRef; seat: number; spot: SpotType } {
  if (input.game === "preflop") {
    const m = input.manifest;
    return { ref: preflopRef(m, input.build, input.nodeId), seat: m.nodes[input.nodeId].actor, spot: spotType(m, input.nodeId) };
  }
  const node = input.flop.nodes[input.nodeId];
  const seatName = node.actor === 0 ? input.scenario.oop : input.scenario.ip;
  return {
    ref: postflopRef(input.scenario.id, input.flop, input.nodeId),
    seat: Math.max(0, SEATS.indexOf(seatName as (typeof SEATS)[number])),
    spot: STREET_SPOT[node.street],
  };
}

/** the record of an answer, as it is saved */
function attemptOf(input: AnswerInput, { ref, seat, spot }: ReturnType<typeof placeOf>): Attempt {
  return withPosition<Omit<Attempt, "pos" | "build">>(
    {
      ts: input.now,
      sessionId: input.sessionId,
      mode: input.mode,
      solution: ref.solution,
      nodeId: input.nodeId,
      hand: input.hand,
      seat,
      spot,
      chosen: input.chosen,
      best: input.best,
      grade: input.grade,
      evLoss: input.evLoss,
      score: input.score,
      ms: input.ms,
      rng: input.rng,
      timeout: input.timeout,
      hint: input.hint,
    },
    ref,
  );
}

/**
 * Records an answer: `input.srs` is updated at once; the Attempt and the SrsItem are written to `repo`.
 * Resolves to the saved SrsItem; rejects when a write fails (the index keeps the new item either way).
 */
export function recordAnswer(repo: Repo, input: AnswerInput): Promise<SrsItem> {
  const place = placeOf(input);
  const attempt = attemptOf(input, place);
  const item = answerSrs(input.srs, place.ref, input.nodeId, input.hand, input.grade, input.now);
  const writes = [repo.addAttempt(attempt), repo.putSrs(item)];
  return Promise.all(writes).then(() => item);
}
