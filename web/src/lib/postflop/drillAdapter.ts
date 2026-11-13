/**
 * The post-flop drill as a game of the shared session (lib/practice/drill.ts, useDrillSession.ts; REFACTOR_PLAN 2-3):
 * how a question is dealt (a spot replayed from the flop, or a hand played through street by street), what an answer
 * leads to, the keys and saving, and what the table shows at each step. Moved out of components/postflop/PostSession.tsx
 * unchanged.
 */
import type { Key } from "../i18n/ja";
import type { AnswerOutcome, DrillAdapter, DrillPhase } from "../practice/drill";
import { judge } from "../practice/engine";
import type { Question } from "../practice/engine";
import { postflopRef } from "../practice/position";
import { recordAnswer } from "../practice/record";
import { SrsIndex } from "../practice/srs";
import type { SrsItem } from "../practice/srs";
import type { Repo } from "../storage/types";
import { newId } from "../util/id";
import { weightedPick } from "../util/rng";
import { COMBOS, classOfCards } from "./combos";
import type { PfFlop, PfNode } from "./decode";
import type { PfIndex, PfScenario } from "./loader";
import { advance, buildPostQuestion, pathSteps, pickCombo, pickSpotNode, spotCandidates } from "./practice";
import type { PEnd, PStep } from "./practice";
import { contextAt, labelEdge } from "./replay";
import type { EdgeLabel, NodeContext } from "./replay";
import type { PostConfig } from "./types";

export interface PostflopRound {
  flop: PfFlop;
  flopIdx: number;
  hero: 0 | 1;
  combo: number;
  /** the opponent's moves and the dealt cards before the question */
  steps: PStep[];
  q: Question | null;
  /** how the hand ended when there is no question */
  ended: PEnd;
  /** the last node reached (the table at the end of a hand) */
  lastNode: number;
}

export interface PostflopOutcome extends AnswerOutcome {
  /** play-through: the node the hand goes on from, or null when the action ends it */
  nextNode: number | null;
  /** play-through: how the action ended the hand (the ResultPanel's `endText`) */
  endKey: Key | null;
}

export interface PostflopDrill extends DrillAdapter<PostflopRound, PStep, PostflopOutcome> {
  /** use this device's spaced-repetition items (until then, combos are picked without them) */
  setSrs(items: SrsItem[]): void;
}

const SHORTCUT_KINDS: [string, number][] = [
  ["f", 0],
  ["c", 1],
  ["r", 2],
  ["a", 3],
];

const END_KEY: Record<number, Key> = { [-1]: "pf.end.fold", [-3]: "pf.end.showdown", [-4]: "pf.end.allin", [-2]: "pf.end.pruned" };

export function createPostflopDrill(opts: {
  config: PostConfig;
  repo: Repo;
  rnd: () => number;
  now?: () => number;
  /** the index of scenarios and flops (lib/postflop/loader.ts loadIndex) */
  index: () => Promise<PfIndex>;
  /** a flop's solution (lib/postflop/loader.ts loadFlop) */
  flop: (scenario: string, flop: number) => Promise<PfFlop>;
}): PostflopDrill {
  const { config, repo, rnd } = opts;
  const now = opts.now ?? Date.now;
  let srs = new SrsIndex();
  let sc: PfScenario | undefined;
  /** made on the first answer */
  let sessionId = "";

  const question = (flop: PfFlop, nodeId: number | null, combo: number) => (nodeId !== null ? buildPostQuestion(flop, nodeId, combo, rnd, config.rng) : null);

  async function start(): Promise<PostflopRound | null> {
    let index: PfIndex;
    try {
      index = await opts.index();
    } catch {
      return null;
    }
    sc = index.scenarios.find((s) => s.id === config.scenario);
    for (let tries = 0; tries < 10; tries++) {
      const flopIdx = config.flop ?? Math.floor(rnd() * index.flops.length);
      const flop = await opts.flop(config.scenario, flopIdx);
      const hero = (config.hero ?? (rnd() < 0.5 ? 0 : 1)) as 0 | 1;
      if (config.kind === "spot") {
        const nodes = spotCandidates(flop, { hero: config.hero === null ? null : hero, streets: config.streets });
        if (!nodes.length) continue;
        const nodeId = pickSpotNode(flop, nodes, 0.5, rnd);
        const node = flop.nodes[nodeId];
        // spaced repetition by position: the item of (scenario, flop + line, combo)
        const ref = postflopRef(config.scenario, flop, nodeId);
        const combo = pickCombo(node, rnd, (c) => srs.find(ref.solution, ref.pos, c), now());
        return { flop, flopIdx, hero: node.actor as 0 | 1, combo, steps: pathSteps(flop, nodeId), q: question(flop, nodeId, combo), ended: null, lastNode: nodeId };
      }
      // hero's hand from the range at the hero's first decision
      const first = flop.nodes.find((n) => n.type === "decision" && n.actor === hero && n.street === 0 && n.data)!;
      const combo = throughCombo(first, flop.board, config.heroClass, rnd);
      const used = [...flop.board, COMBOS[combo].c1, COMBOS[combo].c2];
      const out = advance(flop, 0, hero, used, combo, rnd);
      return { flop, flopIdx, hero, combo, steps: out.steps, q: question(flop, out.heroNode, combo), ended: out.ended, lastNode: out.lastNode };
    }
    return null;
  }

  return {
    setSrs(items) {
      srs = new SrsIndex(items);
    },
    start,
    steps: (r) => r.steps,
    question: (r) => r.q,

    answer(r, i) {
      const edge = r.flop.nodes[r.q!.nodeId].edges[i];
      return { j: judge(r.q!, i), nextNode: edge.code >= 0 ? edge.code : null, endKey: config.kind === "through" ? (END_KEY[edge.code] ?? null) : null };
    },

    async next(r, a) {
      if (config.kind !== "through" || a.nextNode === null) return null;
      const heroCards = [COMBOS[r.combo].c1, COMBOS[r.combo].c2];
      // the board so far (cards already dealt) must not be redealt
      const ctx = contextAt(r.flop, a.nextNode);
      const out = advance(r.flop, a.nextNode, r.hero, [...ctx.board, ...heroCards], r.combo, rnd);
      return { ...r, steps: out.steps, q: question(r.flop, out.heroNode, r.combo), ended: out.ended, lastNode: out.lastNode };
    },

    shortcuts(r) {
      const out: Record<string, number> = {};
      if (!r.q) return out;
      const edges = r.flop.nodes[r.q.nodeId].edges;
      for (const [key, kind] of SHORTCUT_KINDS) {
        const i = edges.findIndex((e) => e.kind === kind);
        if (i >= 0) out[key] = i;
      }
      edges.forEach((_, i) => {
        if (i < 9) out[String(i + 1)] = i;
      });
      return out;
    },

    // time limit: fold, else check, else the first action
    timeout(r) {
      const edges = r.flop.nodes[r.q!.nodeId].edges;
      const fold = edges.findIndex((e) => e.kind === 0);
      const chk = edges.findIndex((e) => e.kind === 1);
      return fold >= 0 ? fold : chk >= 0 ? chk : 0;
    },

    record(r, a) {
      if (!sc) return;
      const q = r.q!;
      // persist (local-first): the screen does not wait for the writes; the index of spaced repetition is updated at once.
      // The record is found by the flop's board, the line and the build ID (lib/practice/record.ts), not by the flop's index.
      recordAnswer(repo, {
        game: "postflop",
        mode: config.kind === "spot" ? "postSpot" : "post",
        scenario: sc,
        flop: r.flop,
        srs,
        sessionId: (sessionId ||= newId("p-")),
        nodeId: q.nodeId,
        hand: r.combo,
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

/** play-through: the hero's combo, weighted by the range at the hero's first decision */
function throughCombo(first: PfNode, board: number[], heroClass: number | undefined, rnd: () => number): number {
  const d = first.data!;
  const w = new Float64Array(d.hands.length);
  for (let j = 0; j < d.hands.length; j++) {
    const c = COMBOS[d.hands[j]];
    // a continued preflop hand keeps its chart class; hands that collide with the board are impossible
    const okClass = heroClass === undefined || classOfCards(c.c1, c.c2) === heroClass;
    w[j] = okClass && !board.includes(c.c1) && !board.includes(c.c2) ? d.weight[j] : 0;
  }
  return d.hands[w.some((x) => x > 0) ? weightedPick(w, rnd) : weightedPick(d.weight, rnd)];
}

export interface PostTableView {
  ctx: NodeContext;
  node: PfNode;
  /** each player's last move on the table (cleared when a card is dealt) */
  last: (EdgeLabel | null)[];
  /** chips in front of each player on this street */
  streetBets: [number, number];
  foldedP: number | null;
  pot: number;
  nodeId: number;
  stacks: [number, number];
}

/** what the table shows after `shown` steps of the round (and, once answered, the hero's `chosen` action) */
export function postTableView(round: PostflopRound, shown: number, phase: DrillPhase, chosen: number | null): PostTableView {
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
  const last: (EdgeLabel | null)[] = [null, null];
  let streetBets: [number, number] = ctx.streetInv;
  let foldedP: number | null = null;
  for (let i = 0; i < Math.min(shown, round.steps.length); i++) {
    const s = round.steps[i];
    if (s.card !== null) {
      last[0] = null;
      last[1] = null;
    } else if (s.label) {
      last[s.actor] = s.label;
      if (s.label.key === "fold") foldedP = s.actor;
    }
  }
  // the move that just ended the hand is not part of a node's context
  if (shown > 0 && round.steps[shown - 1].toNode < 0 && round.steps[shown - 1].label) {
    const s = round.steps[shown - 1];
    const bump = streetBets.slice() as [number, number];
    const e = flop.nodes[s.nodeId].edges[s.edgeIndex];
    if (e.kind !== 0) bump[s.actor] = e.amount;
    streetBets = bump;
  }
  if (phase === "answered" && chosen !== null && round.q) {
    const n = flop.nodes[round.q.nodeId];
    const e = n.edges[chosen];
    last[n.actor] = labelEdge(flop, n.id, chosen);
    if (e.kind === 0) foldedP = n.actor;
    else {
      const bump = streetBets.slice() as [number, number];
      bump[n.actor] = e.amount;
      streetBets = bump;
    }
  }
  const extra = streetBets[0] - ctx.streetInv[0] + (streetBets[1] - ctx.streetInv[1]);
  const stacks: [number, number] = [flop.stack - node.inv[0] - streetBets[0] + ctx.streetInv[0], flop.stack - node.inv[1] - streetBets[1] + ctx.streetInv[1]];
  return { ctx, node, last, streetBets, foldedP, pot: ctx.pot + extra, nodeId, stacks };
}
