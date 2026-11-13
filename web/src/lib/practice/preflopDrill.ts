/**
 * The pre-flop drill as a game of the shared session (lib/practice/drill.ts, useDrillSession.ts): how a question is
 * picked (a spot, a fixed list, or a whole hand played from the button), what an answer leads to, the keys and saving.
 * Moved out of components/practice/Session.tsx unchanged (REFACTOR_PLAN 2-2).
 */
import { Card, comboCount, matchesFilter, NUM_CLASSES, randomCombo } from "../poker/hands";
import type { Key } from "../i18n/ja";
import { applyAction, initialState, stateAt } from "../solution/tree";
import { ActionKind, Terminal } from "../solution/types";
import type { PublicState } from "../solution/types";
import type { Repo } from "../storage/types";
import { newId } from "../util/id";
import { shuffle, weightedPick } from "../util/rng";
import type { AnswerOutcome, DrillAdapter } from "./drill";
import { buildQuestion, judge, NodeSource, PendingStep, playOutOpponents, Question, stepsTo } from "./engine";
import { preflopRef } from "./position";
import { recordAnswer } from "./record";
import { candidateNodes, pickHand, pickNode, PracticeFilter } from "./sampler";
import { SrsIndex } from "./srs";
import type { SrsItem } from "./srs";

export interface PreflopRound {
  heroSeat: number;
  hand: number;
  cards: [Card, Card];
  queue: PendingStep[];
  startState: PublicState;
  q: Question | null;
  /** hand mode: where the hand stands when it ends without another decision */
  endedWith: Terminal | -2 | null;
}

export interface PreflopOutcome extends AnswerOutcome {
  /** the table when the hero decided */
  before: PublicState;
  heroAfter: PublicState;
  /** the hero's next node in hand mode, or null when the action ends the line */
  nextNode: number | null;
  term: Terminal | -2 | null;
  /** hand mode: how the hand ended with this answer (the ResultPanel's `endText`) */
  endKey: Key | null;
}

/** what the drill reads from the practice settings (components/practice/types.ts PracticeConfig) */
export interface PreflopDrillConfig {
  mode: "spot" | "hand";
  filter: PracticeFilter;
  rng: boolean;
  fixed?: { nodeId: number; hand: number }[];
}

export interface PreflopDrill extends DrillAdapter<PreflopRound, PendingStep, PreflopOutcome> {
  /** use this device's spaced-repetition items (until then, hands are picked without them) */
  setSrs(items: SrsItem[]): void;
}

const SHORTCUT_KINDS: [string, ActionKind][] = [
  ["f", ActionKind.Fold],
  ["c", ActionKind.Call],
  ["r", ActionKind.Raise],
  ["a", ActionKind.AllIn],
];

export function createPreflopDrill(opts: { store: NodeSource & { build: string }; repo: Repo; config: PreflopDrillConfig; rnd: () => number; now?: () => number }): PreflopDrill {
  const { store, repo, config, rnd } = opts;
  const now = opts.now ?? Date.now;
  const m = store.manifest;
  const nodes = candidateNodes(m, config.filter);
  let srs = new SrsIndex();
  /** made on the first answer */
  let sessionId = "";
  let fixedOrder: number[] = [];
  let fixedPos = 0;

  const round = (heroSeat: number, hand: number, cards: [Card, Card], queue: PendingStep[], q: Question): PreflopRound => ({ heroSeat, hand, cards, queue, startState: initialState(m), q, endedWith: null });

  async function startSpot(): Promise<PreflopRound | null> {
    if (config.fixed?.length) {
      // a fixed question list: shuffle once per pass
      if (fixedPos >= fixedOrder.length) {
        fixedOrder = shuffle(
          config.fixed.map((_, i) => i),
          rnd,
        );
        fixedPos = 0;
      }
      const item = config.fixed[fixedOrder[fixedPos++]];
      const sol = await store.node(item.nodeId);
      const q = buildQuestion(m, item.nodeId, sol, item.hand, rnd, config.rng);
      return round(m.nodes[item.nodeId].actor, item.hand, q.cards, stepsTo(m, item.nodeId), q);
    }
    if (!nodes.length) return null;
    for (let tries = 0; tries < 12; tries++) {
      const nodeId = pickNode(m, nodes, config.filter, rnd);
      const sol = await store.node(nodeId);
      // spaced repetition by position: the item of (solution, position key, hand)
      const pos = preflopRef(m, store.build, nodeId).pos;
      const hand = pickHand(sol, config.filter, rnd, (h) => srs.find(m.id, pos, h), now());
      if (sol.weight[hand] < 0.02 || !matchesFilter(hand, config.filter.hands)) continue;
      const q = buildQuestion(m, nodeId, sol, hand, rnd, config.rng);
      return round(m.nodes[nodeId].actor, hand, q.cards, stepsTo(m, nodeId), q);
    }
    return null;
  }

  async function startHand(): Promise<PreflopRound | null> {
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
      return round(heroSeat, hand, cards, out.steps, q);
    }
    return null;
  }

  return {
    setSrs(items) {
      srs = new SrsIndex(items);
    },
    start: () => (config.mode === "spot" ? startSpot() : startHand()),
    steps: (r) => r.queue,
    question: (r) => r.q,

    answer(r, i) {
      const q = r.q!;
      const meta = m.nodes[q.nodeId];
      const action = meta.actions[i];
      const before = stateAt(m, q.nodeId);
      const ended = action.child < 0;
      const endKey: Key = action.child === -2 ? "term.pruned" : action.term === Terminal.Fold ? "term.fold" : action.term === Terminal.Flop ? "term.flop" : action.term === Terminal.FlopMulti ? "term.flopMulti" : "term.allin";
      return {
        j: judge(q, i),
        before,
        heroAfter: applyAction(before, meta.actor, action),
        nextNode: ended ? null : action.child,
        term: action.child === -2 ? -2 : ended ? action.term : null,
        endKey: config.mode === "hand" && ended ? endKey : null,
      };
    },

    async next(r, a) {
      if (config.mode !== "hand" || a.nextNode === null) return null;
      const out = await playOutOpponents(store, a.nextNode, r.heroSeat, rnd);
      let q: Question | null = null;
      if (out.heroNode !== null) {
        const sol = await store.node(out.heroNode);
        q = { ...buildQuestion(m, out.heroNode, sol, r.hand, rnd, config.rng), cards: r.cards };
      }
      return { ...r, queue: out.steps, startState: a.heroAfter, q, endedWith: out.ended };
    },

    shortcuts(r) {
      const out: Record<string, number> = {};
      if (!r.q) return out;
      const acts = m.nodes[r.q.nodeId].actions;
      acts.forEach((_, i) => {
        if (i < 9) out[String(i + 1)] = i;
      });
      for (const [key, kind] of SHORTCUT_KINDS) {
        const i = acts.findIndex((a) => a.kind === kind);
        if (i >= 0) out[key] = i;
      }
      return out;
    },

    // time limit: fold, or the first action where folding is not on offer
    timeout(r) {
      const fold = m.nodes[r.q!.nodeId].actions.findIndex((a) => a.kind === ActionKind.Fold);
      return fold >= 0 ? fold : 0;
    },

    record(r, a) {
      const q = r.q!;
      // persist (local-first): the screen does not wait for the writes; the index of spaced repetition is updated at once
      recordAnswer(repo, {
        game: "preflop",
        mode: config.mode,
        manifest: m,
        build: store.build,
        srs,
        sessionId: (sessionId ||= newId("s-")),
        nodeId: q.nodeId,
        hand: q.hand,
        chosen: a.j.chosen,
        best: a.j.bestIndex,
        grade: a.j.grade,
        evLoss: a.j.evLoss,
        score: a.score,
        ms: a.ms,
        rng: q.roll !== null,
        timeout: a.timeout,
        hint: a.hint,
        now: now(),
      }).catch(() => {});
    },
  };
}
