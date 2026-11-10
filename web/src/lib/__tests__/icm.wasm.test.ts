import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classInfo } from "../poker/hands";
import { decodeIcm, IcmSolution, parsePayouts, POSITIONS, rangePercent, toConfig } from "../icm/model";
import { PUBLIC, startWorker } from "./workerHelper";

const eqFile = readFileSync(path.join(PUBLIC, "data/equity169.bin"));
const eq = new Uint16Array(eqFile.buffer.slice(eqFile.byteOffset, eqFile.byteOffset + eqFile.byteLength));

async function solve(stacks: number[], payouts: number[], iterations: number, ante = 0): Promise<{ sol: IcmSolution; exploit: number }> {
  const call = startWorker();
  await call({ type: "icmInit", eq });
  const { handle } = await call({ type: "icmCreate", cfg: toConfig({ stacks, sb: 0.5, bb: 1, ante, payouts }) });
  await call({ type: "icmRun", handle, iterations, chunk: 50, restartAt: Math.floor(iterations / 2), checkEvery: 100000 });
  const out = await call({ type: "icmExport", handle });
  return { sol: decodeIcm(out.data), exploit: out.exploit };
}

const combos = (h: number) => classInfo(h).combos;
const pct = (s: IcmSolution, player: number, facing: number | null) => rangePercent(s.nodes.find((n) => n.player === player && n.facing === facing)!, combos);

describe("ICM push/fold through the real WebAssembly worker", () => {
  it("heads-up winner-take-all reproduces the chip-EV push/fold ranges", async () => {
    const { sol, exploit } = await solve([10, 10], [1], 3000);
    expect(exploit).toBeLessThan(0.3);
    expect(sol.players).toBe(2);
    expect(sol.startEquity[0]).toBeCloseTo(50, 3);
    const jam = pct(sol, 0, null);
    const call = pct(sol, 1, 0);
    expect(jam).toBeGreaterThan(54);
    expect(jam).toBeLessThan(63);
    expect(call).toBeGreaterThan(34);
    expect(call).toBeLessThan(41);
  }, 60_000);

  it("a three-handed bubble: ICM pressure tightens every call, equities add up, values are consistent", async () => {
    const stacks = [12, 6, 12];
    const wta = await solve(stacks, [1], 1500);
    const icm = await solve(stacks, [50, 30, 20], 1500);
    expect(icm.sol.startEquity.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    expect(icm.sol.startEquity[1]).toBeLessThan(icm.sol.startEquity[0]);
    // ICM equity compresses the differences: the 6bb stack owns 20% of the chips but more than 20% of the pool
    expect(icm.sol.startEquity[1]).toBeGreaterThan(22);
    for (const [p, j] of [[2, 1], [1, 0], [2, 0]] as const) expect(pct(icm.sol, p, j)).toBeLessThan(pct(wta.sol, p, j) - 3);
    // every decision: the chosen action is at least as good as the alternative (average strategy ~ best response)
    for (const n of icm.sol.nodes) {
      for (let h = 0; h < 169; h++) {
        if (n.weight[h] < 0.05) continue;
        const best = Math.max(n.evAct[h], n.evFold[h]);
        const mix = n.freq[h] * n.evAct[h] + (1 - n.freq[h]) * n.evFold[h];
        expect(best - mix).toBeLessThan(1.5); // % of the prize pool; the average strategy of CFR+ is approximate
      }
    }
    // AA always calls
    expect(icm.sol.nodes.find((n) => n.player === 2 && n.facing === 1)!.freq[0]).toBeGreaterThan(0.99);
  }, 60_000);

  it("a nine-handed final table with antes solves quickly and the shortest stacks jam widest", async () => {
    const stacks = [22, 18, 15, 30, 9, 12, 25, 14, 20];
    const t0 = Date.now();
    const { sol, exploit } = await solve(stacks, [30, 20, 14, 10, 8, 7, 5, 4, 2], 800, 0.125);
    const secs = (Date.now() - t0) / 1000;
    expect(exploit).toBeLessThan(5);
    expect(sol.nodes.filter((n) => n.facing === null)).toHaveLength(8);
    expect(sol.nodes).toHaveLength(8 + (8 * 9) / 2);
    expect(pct(sol, 4, null)).toBeGreaterThan(pct(sol, 0, null));
    expect(secs).toBeLessThan(40);
  }, 120_000);

  it("positions and payout parsing", () => {
    for (let n = 2; n <= 9; n++) {
      expect(POSITIONS[n]).toHaveLength(n);
      expect(POSITIONS[n].slice(-2)).toEqual(["SB", "BB"]);
    }
    expect(parsePayouts("50, 30 / 20")).toEqual([50, 30, 20]);
    expect(parsePayouts("")).toBeNull();
    expect(parsePayouts("50,x")).toBeNull();
    expect(parsePayouts("0,0")).toBeNull();
  });
});
