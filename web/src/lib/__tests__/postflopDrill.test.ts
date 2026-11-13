/**
 * The post-flop drill (REFACTOR_PLAN 2-3). The references are the post-flop screen's code before the step
 * (components/postflop/PostSession.tsx and lib/postflop/practice.ts up to step 2-2), restated here where it is needed:
 *   question  buildPostQuestion put this combo's numbers into a one-hand NodeSolution (`barSol`, Float32Arrays) for
 *             the frequency bars and the explanation; the question now carries them itself
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFlop, PfFlop } from "../postflop/decode";
import { buildPostQuestion } from "../postflop/practice";
import { buildQuestion } from "../practice/engine";
import { NUM_CLASSES } from "../poker/hands";
import { mulberry32 } from "../util/rng";
import { loadManifest, loadNode, walk } from "./helpers";

const DIR = path.resolve(__dirname, "../../../public/postflop");
const cache = new Map<string, PfFlop>();
const load = (scenario: string, flop: number): PfFlop => {
  const k = `${scenario}/${flop}`;
  if (!cache.has(k)) cache.set(k, { ...decodeFlop(new Uint8Array(gunzipSync(readFileSync(path.join(DIR, scenario, `${flop}.bin.gz`))))), build: `b-${k}` });
  return cache.get(k)!;
};
const FLOPS = [load("srp-btn-bb", 3), load("3bp-btn-bb", 0), load("srp-co-bb", 1)];

describe("post-flop question: this combo's numbers", () => {
  it("are what the one-hand solution of the bars held (frequency and EV in single precision, weight, equity, no EQR)", () => {
    let checked = 0;
    for (const flop of FLOPS) {
      for (const node of flop.nodes) {
        const d = node.data;
        if (node.type !== "decision" || !d) continue;
        for (let j = 0; j < d.n; j += 37) {
          const q = buildPostQuestion(flop, node.id, d.hands[j], mulberry32(j), false);
          // the old barSol: Float32Array(na * 169) with this combo at class index 0
          const na = node.edges.length;
          const freq = new Float32Array(na);
          const ev = new Float32Array(na);
          for (let a = 0; a < na; a++) {
            freq[a] = d.freq[a * d.n + j];
            ev[a] = d.best[j] - d.loss[a * d.n + j];
          }
          expect(q.stats.map((s) => Math.fround(s.freq))).toEqual([...freq]);
          expect(q.stats.map((s) => Math.fround(s.ev))).toEqual([...ev]);
          // grading keeps the double-precision EV (as before)
          q.stats.forEach((s, a) => expect(s.ev).toBe(d.best[j] - d.loss[a * d.n + j]));
          expect(q.weight).toBe(new Float32Array([d.weight[j]])[0]);
          expect(q.equity).toBe(new Float32Array([d.eq[j]])[0]);
          expect(q.eqr).toBeNull();
          expect(q.sol.eqr).toBeNull(); // the chart never had one either: the EQR line stays hidden post-flop
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("pre-flop question: this hand's numbers", () => {
  it("are the solution's at the hand class (what the panel read from `sol` before)", () => {
    const m = loadManifest();
    for (const nodeId of [walk(m, ""), walk(m, "FFR"), walk(m, "R")]) {
      const sol = loadNode(m, nodeId);
      for (let h = 0; h < NUM_CLASSES; h += 7) {
        const q = buildQuestion(m, nodeId, sol, h, mulberry32(h), false);
        expect(q.weight).toBe(sol.weight[h]);
        expect(q.equity).toBe(sol.equity[h]);
        expect(q.eqr).toBe(sol.eqr ? sol.eqr[h] : null);
        q.stats.forEach((s, a) => {
          expect(s.freq).toBe(sol.freq[a * NUM_CLASSES + h]);
          expect(s.ev).toBe(sol.ev[a * NUM_CLASSES + h]);
          // single precision already: the panel's Math.fround changes nothing pre-flop
          expect(Math.fround(s.ev)).toBe(s.ev);
          expect(Math.fround(s.freq)).toBe(s.freq);
        });
      }
    }
  });
});
