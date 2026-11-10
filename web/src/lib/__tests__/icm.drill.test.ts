import { describe, expect, it } from "vitest";
import { judgeIcm, pickIcmQuestion } from "../icm/drill";
import type { IcmNode, IcmSolution } from "../icm/model";
import { mulberry32 } from "../util/rng";

const K = 169;
function node(player: number, facing: number | null, reach: number): IcmNode {
  const weight = new Float32Array(K).fill(0);
  weight[0] = 1; // AA
  weight[1] = 1; // AKs
  weight[100] = 0.5;
  const freq = new Float32Array(K);
  freq[0] = 1; // AA always acts
  freq[1] = 0.5; // AKs mixes
  freq[100] = 0;
  const evAct = new Float32Array(K).fill(10);
  const evFold = new Float32Array(K).fill(9);
  evFold[1] = 10; // AKs: indifferent
  evAct[100] = 8; // the weak hand: acting loses 1 % of the pool
  return { player, facing, reach, weight, freq, evAct, evFold };
}

const sol: IcmSolution = { players: 3, startEquity: [33, 33, 34], nodes: [node(1, null, 1), node(1, 0, 0.25), node(2, 0, 0.2)] };

describe("ICM drill", () => {
  it("draws decisions of the chosen player by reach and hands by weight", () => {
    const rnd = mulberry32(5);
    const seen = { open: 0, vs: 0 };
    const hands = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const q = pickIcmQuestion(sol, 1, rnd)!;
      expect(q.node.player).toBe(1);
      if (q.node.facing === null) seen.open++;
      else seen.vs++;
      hands.add(q.hand);
    }
    // reach 1 vs 0.25: about 4:1
    expect(seen.open / seen.vs).toBeGreaterThan(2.5);
    expect(seen.open / seen.vs).toBeLessThan(6);
    expect([...hands].sort((a, b) => a - b)).toEqual([0, 1, 100]);
    // a player with no decisions (nobody reaches it) gets no question
    expect(pickIcmQuestion(sol, 0, rnd)).toBeNull();
  });

  it("grades by the loss in prize-pool percent", () => {
    const q = (hand: number) => ({ node: sol.nodes[0], hand });
    // AA: acting is best; folding costs 1 %
    expect(judgeIcm(q(0), true).grade).toBe("best");
    const bad = judgeIcm(q(0), false);
    expect(bad.grade).toBe("blunder");
    expect(bad.evLoss).toBeCloseTo(1, 5);
    // AKs mixes 50/50 at equal EV: both choices are fine
    expect(["best", "correct"]).toContain(judgeIcm(q(1), true).grade);
    expect(["best", "correct"]).toContain(judgeIcm(q(1), false).grade);
    // the weak hand: acting loses 1 %
    const weak = judgeIcm(q(100), true);
    expect(weak.grade).toBe("blunder");
    expect(judgeIcm(q(100), false).grade).toBe("best");
    expect(weak.evAct).toBe(8);
  });
});
