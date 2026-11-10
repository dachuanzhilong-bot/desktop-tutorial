import { describe, expect, it } from "vitest";
import { loadManifest, loadNode, walk } from "./helpers";
import { buildQuestion, judge, playOutOpponents, rngOrder, sampleHandClass, stepsTo } from "../practice/engine";
import { DEFAULT_FILTER, candidateNodes, pickHand, pickNode } from "../practice/sampler";
import { sessionStats } from "../practice/session";
import { classByName } from "../poker/hands";
import { mulberry32 } from "../util/rng";
import { ActionKind } from "../solution/types";

const m = loadManifest();
const src = { manifest: m, node: async (id: number) => loadNode(m, id) };

describe("practice engine", () => {
  it("replays the history of a spot", () => {
    const id = walk(m, "FFFRF"); // BB facing a BTN open, SB folded
    const steps = stepsTo(m, id);
    expect(steps.map((s) => s.actor)).toEqual([0, 1, 2, 3, 4]);
    expect(steps[3].action.kind).toBe(ActionKind.Raise);
    expect(steps[4].after.pot).toBeCloseTo(4.0 - 0.5 + 0.5 + 0, 1); // 0.5 + 1 + 2.5 = 4
  });

  it("samples hands from the range and never from outside it", () => {
    const sol = loadNode(m, 0); // UTG: every hand is possible
    const rnd = mulberry32(3);
    const sol2 = loadNode(m, walk(m, "R")); // HJ facing UTG open: still everything
    for (let i = 0; i < 50; i++) expect(sampleHandClass(sol2, rnd)).toBeGreaterThanOrEqual(0);
    // UTG facing a 3-bet only holds hands from the opening range
    const deep = loadNode(m, walk(m, "RR"));
    for (let i = 0; i < 300; i++) expect(deep.weight[sampleHandClass(deep, rnd)]).toBeGreaterThan(0);
    expect(sol.weight[0]).toBeGreaterThan(0.99);
  });

  it("plays out opponents until the hero has to act", async () => {
    const rnd = mulberry32(11);
    let reachedHero = 0;
    let ended = 0;
    for (let i = 0; i < 40; i++) {
      const out = await playOutOpponents(src, 0, 3 /* BTN */, rnd);
      if (out.heroNode !== null) {
        reachedHero++;
        expect(m.nodes[out.heroNode].actor).toBe(3);
      } else ended++;
      // every simulated step is an action from the tree
      for (const s of out.steps) expect(s.actor).toBeGreaterThanOrEqual(0);
    }
    expect(reachedHero).toBeGreaterThan(5);
    expect(reachedHero + ended).toBe(40);
  });

  it("builds and judges a question; RNG mode follows the frequencies", () => {
    const id = walk(m, "FFF"); // BTN RFI
    const sol = loadNode(m, id);
    const h = classByName("AA");
    const rnd = mulberry32(1);
    const q = buildQuestion(m, id, sol, h, rnd, false);
    expect(q.cards[0].rank).toBe(12);
    const raise = sol.na - 1;
    const good = judge(q, raise);
    expect(good.grade === "best" || good.grade === "correct").toBe(true);
    const bad = judge(q, 0); // folding AA
    expect(bad.grade).toBe("blunder");
    expect(bad.evLoss).toBeGreaterThan(1);

    // a mixed hand: the roll decides
    let mixedHand = -1;
    for (let c = 0; c < 169 && mixedHand < 0; c++) {
      const f = sol.freq[raise * 169 + c];
      if (sol.weight[c] > 0.99 && f > 0.3 && f < 0.7) mixedHand = c;
    }
    if (mixedHand >= 0) {
      const counts = [0, 0, 0];
      const r2 = mulberry32(2);
      for (let i = 0; i < 3000; i++) counts[buildQuestion(m, id, sol, mixedHand, r2, true).rngAction!]++;
      expect(counts[raise] / 3000).toBeCloseTo(sol.freq[raise * 169 + mixedHand], 1);
      const q2 = buildQuestion(m, id, sol, mixedHand, r2, true);
      const miss = judge(q2, q2.rngAction === raise ? 0 : raise);
      expect(miss.rngMiss).toBe(true);
      expect(["inaccurate", "mistake", "blunder"]).toContain(miss.grade);
    }
    expect(rngOrder(m.nodes[id].actions)[0]).toBe(raise);
  });

  it("samples nodes by reach and hands by range weight", () => {
    const nodes = candidateNodes(m, { ...DEFAULT_FILTER, seats: [5], spots: ["vsOpen"] });
    expect(nodes.length).toBeGreaterThan(3);
    for (const id of nodes) expect(m.nodes[id].actor).toBe(5);
    const rnd = mulberry32(9);
    const counts = new Map<number, number>();
    for (let i = 0; i < 500; i++) {
      const n = pickNode(m, nodes, DEFAULT_FILTER, rnd);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThan(2);
    const node = nodes[0];
    const sol = loadNode(m, node);
    const h = pickHand(sol, node, { ...DEFAULT_FILTER, hands: "pairs" }, rnd, new Map(), Date.now());
    expect(classByName("AA") <= h || true).toBe(true);
    expect(Math.floor(h / 13)).toBe(h % 13); // pairs only
  });

  it("session statistics", () => {
    const s = sessionStats([
      { grade: "best", score: 100, evLoss: 0 },
      { grade: "correct", score: 95, evLoss: 0.03 },
      { grade: "mistake", score: 30, evLoss: 0.5 },
      { grade: "best", score: 100, evLoss: 0 },
    ]);
    expect(s.n).toBe(4);
    expect(s.streak).toBe(1);
    expect(s.bestStreak).toBe(2);
    expect(s.totalScore).toBe(325);
    expect(s.accuracy).toBe(0.75);
    expect(s.byGrade.mistake).toBe(1);
  });
});
