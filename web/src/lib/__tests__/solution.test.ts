import { describe, expect, it } from "vitest";
import { loadManifest, loadNode, mix, walk } from "./helpers";
import { classByName } from "../poker/hands";
import { history, spotType, stateAt } from "../solution/tree";
import { ActionKind } from "../solution/types";

const m = loadManifest();
const K = 169;
const F = (sol: ReturnType<typeof loadNode>, name: string, a: number) => sol.freq[a * K + classByName(name)];

describe("solution file format", () => {
  it("parses the manifest into a consistent tree", () => {
    expect(m.players).toEqual(["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(m.stack).toBe(100);
    expect(m.nodes[0].actor).toBe(0);
    expect(m.nodes[0].parent).toBe(-1);
    for (const n of m.nodes.slice(1)) {
      expect(n.parent).toBeGreaterThanOrEqual(0);
      expect(m.nodes[n.parent].actions[n.parentAction].child).toBe(n.id);
    }
    expect(m.nodes.length).toBeGreaterThan(150);
  });
  it("frequencies sum to one and are finite for every hand of every node", () => {
    for (const n of m.nodes) {
      const sol = loadNode(m, n.id);
      expect(sol.na).toBe(n.actions.length);
      for (let h = 0; h < K; h++) {
        let s = 0;
        for (let a = 0; a < sol.na; a++) {
          const f = sol.freq[a * K + h];
          expect(Number.isFinite(f)).toBe(true);
          s += f;
        }
        expect(s).toBeCloseTo(1, 4);
        for (let a = 0; a < sol.na; a++) expect(Number.isFinite(sol.ev[a * K + h])).toBe(true);
      }
    }
  });
});

describe("public state replay", () => {
  it("tracks pot, bets and folds", () => {
    const open = m.nodes[0].actions.find((a) => a.kind === ActionKind.Raise)!;
    expect(open.to).toBe(2.5);
    const hj = stateAt(m, open.child);
    expect(hj.pot).toBeCloseTo(4, 6); // 0.5 + 1 + 2.5
    expect(hj.cur).toBe(2.5);
    expect(hj.level).toBe(1);
    expect(hj.lastRaiser).toBe(0);
    const btnOpen = walk(m, "FFFR");
    const sb = stateAt(m, btnOpen);
    expect(sb.inv).toEqual([0, 0, 0, 2.5, 0.5, 1]);
    expect(history(m, walk(m, "FFFRF")).map((h) => h.actor)).toEqual([0, 1, 2, 3, 4]);
  });
  it("classifies spots", () => {
    expect(spotType(m, 0)).toBe("rfi");
    expect(spotType(m, walk(m, "FFFRF"))).toBe("vsOpen");
    expect(spotType(m, walk(m, "FFFFC"))).toBe("limp");
    expect(spotType(m, walk(m, "RR"))).toBe("vs3bet");
    const kinds = new Set(m.nodes.map((n) => spotType(m, n.id)));
    for (const k of ["rfi", "vsOpen", "vs3bet", "vs4bet", "limp", "squeeze"]) expect(kinds.has(k as any), `spot type ${k}`).toBe(true);
  });
});

describe("solution plausibility (known strategy facts)", () => {
  const widths = (path: string) => {
    const sol = loadNode(m, walk(m, path));
    const mx = mix(sol);
    return { raise: mx[mx.length - 1], fold: mx[0], mx, sol };
  };

  it("open ranges widen towards the button", () => {
    const utg = widths("").raise;
    const hj = widths("F").raise;
    const co = widths("FF").raise;
    const btn = widths("FFF").raise;
    expect(utg).toBeGreaterThan(0.12);
    expect(utg).toBeLessThan(0.2);
    expect(utg).toBeLessThan(hj);
    expect(hj).toBeLessThan(co);
    expect(co).toBeLessThan(btn);
    expect(co).toBeGreaterThan(0.22);
    expect(co).toBeLessThan(0.34);
    expect(btn).toBeGreaterThan(0.38);
    expect(btn).toBeLessThan(0.58);
  });

  it("premium hands always open, trash never does from UTG", () => {
    const sol = widths("").sol;
    for (const h of ["AA", "KK", "QQ", "AKs", "AKo"]) expect(F(sol, h, 1), h).toBeGreaterThan(0.97);
    for (const h of ["72o", "83o", "J2o", "T3o"]) expect(F(sol, h, 0), h).toBeGreaterThan(0.97);
  });

  it("the big blind defends wide against late position and tighter against early position", () => {
    const defend = (p: string) => 1 - widths(p).fold;
    const vsBtn = defend("FFFRFF".slice(0, 5));
    const vsUtg = defend("RFFFF");
    expect(vsBtn).toBeGreaterThan(0.55);
    expect(vsBtn).toBeLessThan(0.82);
    expect(vsUtg).toBeGreaterThan(0.25);
    expect(vsUtg).toBeLessThan(0.5);
    expect(vsBtn).toBeGreaterThan(vsUtg);
  });

  it("3-bets with the top of the range, folds junk", () => {
    const sol = widths("FFFRF").sol; // BB vs BTN
    const raise = sol.na - 1;
    for (const h of ["AA", "KK"]) expect(F(sol, h, raise), h).toBeGreaterThan(0.9);
    expect(F(sol, "72o", 0)).toBeGreaterThan(0.95);
  });

  it("an opener 4-bets premium hands and folds weak hands to a 3-bet", () => {
    const sol = loadNode(m, walk(m, "FFFRFR")); // BTN opened, BB 3-bet
    const raise = sol.na - 1;
    expect(F(sol, "AA", raise)).toBeGreaterThan(0.9);
    expect(F(sol, "KK", raise)).toBeGreaterThan(0.8);
    // junk that is not in the opening range has no weight at all
    expect(sol.weight[classByName("72o")]).toBeLessThan(0.01);
  });

  it("folding is accounted for exactly (blinds already posted are lost)", () => {
    const utg = loadNode(m, 0);
    expect(utg.ev[classByName("72o")]).toBeCloseTo(0, 2); // fold EV at UTG
    const sb = loadNode(m, walk(m, "FFFF"));
    expect(sb.ev[classByName("72o")]).toBeCloseTo(-0.5, 2);
    const bb = loadNode(m, walk(m, "FFFRF"));
    expect(bb.ev[classByName("72o")]).toBeCloseTo(-1, 2);
  });

  it("is close to an equilibrium: every action played with real frequency is nearly EV-optimal", () => {
    // Tiered by how often the line occurs: the main lines are solved most precisely, deep/rare lines less so.
    const tiers = [
      { minReach: 0.02, maxGap: 0.05 },
      { minReach: 0.001, maxGap: 0.15 },
    ];
    for (const tier of tiers) {
      let worst = 0;
      let checked = 0;
      for (const n of m.nodes) {
        if (n.reach < tier.minReach) continue;
        const sol = loadNode(m, n.id);
        for (let h = 0; h < K; h++) {
          if (sol.weight[h] < 0.05) continue;
          let best = -Infinity;
          for (let a = 0; a < sol.na; a++) best = Math.max(best, sol.ev[a * K + h]);
          for (let a = 0; a < sol.na; a++) {
            if (sol.freq[a * K + h] < 0.3) continue;
            worst = Math.max(worst, best - sol.ev[a * K + h]);
            checked++;
          }
        }
      }
      expect(checked, `reach>=${tier.minReach}`).toBeGreaterThan(500);
      expect(worst, `reach>=${tier.minReach}`).toBeLessThan(tier.maxGap); // bb
    }
  });

  it("covers every preflop line type the app promises", () => {
    const kinds = new Map<string, number>();
    for (const n of m.nodes) kinds.set(spotType(m, n.id), (kinds.get(spotType(m, n.id)) ?? 0) + 1);
    for (const k of ["rfi", "limp", "vsOpen", "squeeze", "vs3bet", "vsSqueeze", "vs4bet", "vs5bet"]) expect(kinds.get(k) ?? 0, k).toBeGreaterThan(0);
  });

  it("solver convergence is recorded and small", () => {
    const info = m.info as { brGainMax: number; iterations: number; polish: number };
    expect(info.brGainMax).toBeLessThan(0.002); // best-response gain per player, bb
    expect(info.iterations + info.polish).toBeGreaterThanOrEqual(2000);
  });
});
