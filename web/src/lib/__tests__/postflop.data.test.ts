import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFlop, PfFlop } from "../postflop/decode";
import { advance, buildPostQuestion, pathSteps, pickSpotNode, spotCandidates } from "../postflop/practice";
import { COMBOS, NC } from "../postflop/combos";
import { contextAt, labelEdge } from "../postflop/replay";
import { metricOf } from "../postflop/report";
import { judge } from "../practice/engine";
import { mulberry32 } from "../util/rng";

const DIR = path.resolve(__dirname, "../../../public/postflop");
const index = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf8"));
const files: { scenario: string; flop: number }[] = [];
for (const sc of readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const f of readdirSync(path.join(DIR, sc.name)).filter((x) => x.endsWith(".bin.gz"))) files.push({ scenario: sc.name, flop: Number(f.split(".")[0]) });
}
const cache = new Map<string, PfFlop>();
const load = (scenario: string, flop: number) => {
  const k = `${scenario}/${flop}`;
  if (!cache.has(k)) cache.set(k, decodeFlop(new Uint8Array(gunzipSync(readFileSync(path.join(DIR, scenario, `${flop}.bin.gz`))))));
  return cache.get(k)!;
};
const scenarioOf = (id: string) => index.scenarios.find((s: { id: string }) => s.id === id);

describe("postflop solution files", () => {
  it("has the expected scenarios and a sensible number of flops", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(index.scenarios.length).toBeGreaterThanOrEqual(1);
    for (const sc of index.scenarios) expect(files.some((f) => f.scenario === sc.id)).toBe(true);
  });

  it("decodes into a consistent tree", () => {
    for (const { scenario, flop } of files) {
      const f = load(scenario, flop);
      const sc = scenarioOf(scenario);
      expect(f.board).toHaveLength(3);
      expect(f.pot).toBeCloseTo(sc.pot, 5);
      expect(f.stack).toBeCloseTo(sc.stack, 5);
      const root = f.nodes[0];
      expect(root.type).toBe("decision");
      expect(root.actor).toBe(0); // the out-of-position player acts first
      expect(root.street).toBe(0);
      expect(root.reach).toBeCloseTo(1, 3);
      for (const n of f.nodes.slice(1)) {
        expect(n.parent).toBeGreaterThanOrEqual(0);
        expect(f.nodes[n.parent].edges[n.parentEdge].code).toBe(n.id);
        expect(n.street).toBeGreaterThanOrEqual(f.nodes[n.parent].street);
      }
      for (const n of f.nodes) {
        if (n.type === "chance") {
          const cards = n.edges.map((e) => e.kind);
          expect(new Set(cards).size).toBe(cards.length);
          for (const c of cards) expect(contextAt(f, n.id).board.includes(c)).toBe(false);
        }
      }
    }
  });

  it("strategies are proper distributions and ranges only shrink along a line", () => {
    const bad: string[] = [];
    for (const { scenario, flop } of files.slice(0, 6)) {
      const f = load(scenario, flop);
      for (const n of f.nodes) {
        const d = n.data;
        if (!d) continue;
        const na = n.edges.length;
        const board = contextAt(f, n.id).board;
        for (let j = 0; j < d.n; j++) {
          let s = 0;
          for (let a = 0; a < na; a++) {
            s += d.freq[a * d.n + j];
            if (d.loss[a * d.n + j] < 0) bad.push("negative loss");
          }
          if (Math.abs(s - 1) > 1e-3) bad.push(`freq sum ${s}`);
          if (!(d.weight[j] > 0 && d.weight[j] <= 1.0001)) bad.push(`weight ${d.weight[j]}`);
          if (!(d.eq[j] >= 0 && d.eq[j] <= 1)) bad.push(`eq ${d.eq[j]}`);
          if (j > 0 && d.hands[j] <= d.hands[j - 1]) bad.push("hands not sorted");
          const c = COMBOS[d.hands[j]];
          if (board.includes(c.c1) || board.includes(c.c2)) bad.push("combo collides with the board");
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("books the chips correctly: folding loses exactly what is already in", () => {
    let checked = 0;
    for (const { scenario, flop } of files.slice(0, 6)) {
      const f = load(scenario, flop);
      for (const n of f.nodes) {
        const d = n.data;
        if (!d) continue;
        const fa = n.edges.findIndex((e) => e.kind === 0);
        if (fa < 0) continue;
        // facing a bet: there is something to call
        expect(contextAt(f, n.id).toCall).toBeGreaterThan(0);
        for (let j = 0; j < d.n; j++) {
          const loss = d.loss[fa * d.n + j];
          if (loss >= 3.1) continue; // coarse loss code beyond 3 bb
          const evFold = d.best[j] - loss;
          expect(evFold).toBeCloseTo(-n.inv[n.actor], 1);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("checking is only offered when there is nothing to call, and vice versa", () => {
    for (const { scenario, flop } of files.slice(0, 4)) {
      const f = load(scenario, flop);
      for (const n of f.nodes) {
        if (n.type !== "decision") continue;
        const ctx = contextAt(f, n.id);
        const keys = n.edges.map((_, i) => labelEdge(f, n.id, i).key);
        if (ctx.toCall > 0) {
          expect(keys).toContain("fold");
          expect(keys).toContain("call");
          expect(keys).not.toContain("check");
        } else {
          expect(keys).not.toContain("fold");
          expect(keys).toContain("check");
        }
      }
    }
  });

  it("is close to an equilibrium: played actions are nearly EV-optimal, tighter on the frequent lines", () => {
    // Tiered by how often the line occurs (measured: 0.23 / 0.44 / 0.55 bb); rare lines of 3-bet pots are looser (see docs/08).
    const tiers = [
      { minReach: 0.2, max: 0.3 },
      { minReach: 0.1, max: 0.5 },
      { minReach: 0.05, max: 0.8 },
    ];
    for (const tier of tiers) {
      let worst = 0;
      let checked = 0;
      for (const { scenario, flop } of files) {
        const f = load(scenario, flop);
        for (const n of f.nodes) {
          const d = n.data;
          if (!d || n.reach < tier.minReach) continue;
          const na = n.edges.length;
          for (let j = 0; j < d.n; j++) {
            if (d.weight[j] < 0.1) continue;
            for (let a = 0; a < na; a++) {
              if (d.freq[a * d.n + j] < 0.3) continue;
              worst = Math.max(worst, d.loss[a * d.n + j]);
              checked++;
            }
          }
        }
      }
      expect(checked, `reach>=${tier.minReach}`).toBeGreaterThan(500);
      expect(worst, `reach>=${tier.minReach}`).toBeLessThan(tier.max); // bb
    }
  });

  it("solved flops converged (exploitability recorded per flop)", () => {
    for (const { scenario, flop } of files) {
      const s = index.stats[`${scenario}/${flop}`];
      if (!s) continue;
      expect(s.exploit).toBeLessThan(1.2); // % of the pot (measured: 0.16 - 0.83)
      expect(s.eqOop + s.eqIp).toBeGreaterThan(0.93);
      expect(s.eqOop + s.eqIp).toBeLessThan(1.07);
    }
  });
});

describe("postflop practice engine", () => {
  const { scenario, flop } = files[0];
  const f = load(scenario, flop);

  it("plays the opponent until the hero must act, never reusing hero or board cards", () => {
    const rnd = mulberry32(5);
    let reached = 0;
    for (let i = 0; i < 60; i++) {
      const hero = (i % 2) as 0 | 1;
      const first = f.nodes.find((n) => n.type === "decision" && n.actor === hero && n.data)!;
      const combo = first.data!.hands[Math.floor(rnd() * first.data!.hands.length)];
      const used = [...f.board, COMBOS[combo].c1, COMBOS[combo].c2];
      const out = advance(f, 0, hero, used, combo, rnd);
      for (const s of out.steps) if (s.card !== null) expect(used.includes(s.card)).toBe(false);
      if (out.heroNode !== null) {
        reached++;
        expect(f.nodes[out.heroNode].actor).toBe(hero);
        const q = buildPostQuestion(f, out.heroNode, combo, rnd, false);
        const sum = q.stats.reduce((a, s) => a + s.freq, 0);
        expect(sum).toBeCloseTo(1, 3);
        const best = q.stats.reduce((b, s, k) => (s.ev > q.stats[b].ev ? k : b), 0);
        expect(judge(q, best).grade).toBe("best");
      }
    }
    expect(reached).toBeGreaterThan(30);
  });

  it("spot drills pick nodes of the requested street and replay the line", () => {
    const rnd = mulberry32(8);
    for (const street of [0, 1, 2]) {
      const nodes = spotCandidates(f, { hero: null, streets: [street], minReach: 0.005 });
      if (!nodes.length) continue;
      for (let i = 0; i < 20; i++) {
        const id = pickSpotNode(f, nodes, 0.5, rnd);
        expect(f.nodes[id].street).toBe(street);
        const steps = pathSteps(f, id);
        expect(steps.length).toBeGreaterThanOrEqual(street === 0 ? 0 : 1);
        if (steps.length) expect(steps[steps.length - 1].toNode).toBe(id);
      }
    }
  });

  it("report metrics exist for the solved flops", () => {
    const sc = scenarioOf(scenario);
    const s = index.stats[`${scenario}/${flop}`];
    if (!s) return;
    for (const m of ["oopCheck", "oopBet", "ipBet", "ipBigBet", "eqIp"] as const) {
      const v = metricOf(m, s, sc.pot);
      expect(v).not.toBeNull();
      expect(v!).toBeGreaterThanOrEqual(0);
      expect(v!).toBeLessThanOrEqual(1);
    }
    expect(NC).toBe(1326);
  });
});
