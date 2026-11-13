import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classByName } from "../poker/hands";
import { ActionKind } from "../solution/types";
import { DEPTHS, depthOf, nearestDepth, solutionId } from "../solution/loader";
import { DEFAULT_DEPTH, DEFAULT_SOLUTION, isPreflopSolution, solutionBuild, solutionEntry, SOLUTIONS } from "../solution/catalog";
import { loadManifestFor, loadNodeFor } from "./helpers";

const have = (d: number) => existsSync(path.resolve(__dirname, `../../../public/solutions/cash6max-${d}bb/manifest.json.gz`));

describe("depth helpers", () => {
  it("maps stacks to the nearest solution on a log scale", () => {
    expect(nearestDepth(100)).toBe(100);
    expect(nearestDepth(15)).toBe(20);
    expect(nearestDepth(28)).toBe(20); // sqrt(20*40) = 28.3
    expect(nearestDepth(29)).toBe(40);
    expect(nearestDepth(75)).toBe(60); // sqrt(60*100) = 77.5
    expect(nearestDepth(78)).toBe(100);
    expect(nearestDepth(140)).toBe(100); // sqrt(100*200) = 141
    expect(nearestDepth(142)).toBe(200);
    expect(nearestDepth(500)).toBe(200);
  });
  it("round-trips solution ids", () => {
    for (const d of DEPTHS) expect(depthOf(solutionId(d))).toBe(d);
    expect(depthOf(undefined)).toBe(100);
    // (the spaced-repetition keys that treated 100bb specially are gone with the old records: REFACTOR_PLAN step 1-4)
  });
});

describe("the solution catalog (public/solutions/index.json, REFACTOR_PLAN 2-4)", () => {
  const index: { solutions: { id: string; game?: string; players?: number; stack?: number; build: string }[] } = JSON.parse(
    readFileSync(path.resolve(__dirname, "../../../public/solutions/index.json"), "utf8"),
  );

  it("lists the shipped depths, shallowest first", () => {
    expect(DEPTHS).toEqual([20, 40, 60, 100, 200]);
    expect(SOLUTIONS.map((s) => s.id).sort()).toEqual(index.solutions.map((s) => s.id).sort());
    expect(new Set(DEPTHS).size, "one solution per depth").toBe(DEPTHS.length);
  });

  it.each(index.solutions.map((s) => [s.id, s] as const))("%s: the catalog fields are those of its manifest", (id, s) => {
    const m = loadManifestFor(s.stack!);
    expect(m.id).toBe(id);
    expect(s).toMatchObject({ game: "cash", players: m.players.length, stack: m.stack });
    expect(solutionEntry(id)).toMatchObject({ id, game: "cash", players: m.players.length, stack: m.stack, build: s.build });
    expect(solutionId(m.stack)).toBe(id);
    expect(depthOf(id)).toBe(m.stack);
    expect(solutionBuild(id)).toBe(s.build);
    expect(isPreflopSolution(id)).toBe(true);
  });

  it("the default is the 100bb solution; ids it does not ship are not pre-flop solutions", () => {
    expect(DEFAULT_DEPTH).toBe(100);
    expect(solutionEntry(DEFAULT_SOLUTION)?.stack).toBe(100);
    for (const id of ["post:srp-btn-bb", "cash6max-55bb", "", "100", undefined]) {
      expect(isPreflopSolution(id)).toBe(false);
      expect(depthOf(id)).toBe(DEFAULT_DEPTH);
      expect(solutionBuild(id ?? "")).toBe("");
    }
    // a depth that is not shipped asks for the nearest one's solution
    expect(solutionId(70)).toBe(solutionId(60));
  });
});

describe.each(DEPTHS)("preflop solution at %dbb", (depth) => {
  const ready = have(depth);
  it.skipIf(!ready)("is packed, converged and self-consistent", () => {
    const m = loadManifestFor(depth);
    expect(m.id).toBe(solutionId(depth));
    expect(m.stack).toBe(depth);
    expect(m.players).toEqual(["UTG", "HJ", "CO", "BTN", "SB", "BB"]);
    expect(m.nodes.length).toBeGreaterThan(100);
    expect(Number(m.info.brGainMax)).toBeLessThan(0.05);
    // every raise fits in the stack
    for (const n of m.nodes) for (const a of n.actions) expect(a.to).toBeLessThanOrEqual(depth + 1e-3);
  });

  it.skipIf(!ready)("opens sensible ranges: AA always raises, 72o never, UTG tighter than BTN", () => {
    const m = loadManifestFor(depth);
    const raise = (n: number, h: string) => {
      const sol = loadNodeFor(depth, m, n);
      const meta = m.nodes[n];
      let f = 0;
      meta.actions.forEach((a, i) => {
        if (a.kind === ActionKind.Raise || a.kind === ActionKind.AllIn) f += sol.freq[i * 169 + classByName(h)];
      });
      return f;
    };
    const pct = (n: number) => {
      const sol = loadNodeFor(depth, m, n);
      let num = 0;
      let den = 0;
      for (let h = 0; h < 169; h++) {
        const c = h % 13 === Math.floor(h / 13) ? 6 : Math.floor(h / 13) < h % 13 ? 4 : 12;
        let f = 0;
        m.nodes[n].actions.forEach((a, i) => {
          if (a.kind === ActionKind.Raise || a.kind === ActionKind.AllIn) f += sol.freq[i * 169 + h];
        });
        num += c * f;
        den += c;
      }
      return (100 * num) / den;
    };
    // UTG is node 0; BTN's first decision after three folds
    const fold = (n: number) => m.nodes[n].actions.find((a) => a.kind === ActionKind.Fold)!.child;
    const utg = 0;
    const btn = fold(fold(fold(0)));
    expect(m.nodes[btn].actor).toBe(3);
    expect(raise(utg, "AA")).toBeGreaterThan(0.99);
    expect(raise(utg, "72o")).toBeLessThan(0.01);
    expect(pct(utg)).toBeGreaterThan(4);
    expect(pct(utg)).toBeLessThan(35);
    expect(pct(btn)).toBeGreaterThan(pct(utg) + 5);
    expect(pct(btn)).toBeLessThan(75);
    // the fold value of a player who has put nothing in is exactly zero
    const sol = loadNodeFor(depth, m, utg);
    const foldIdx = m.nodes[utg].actions.findIndex((a) => a.kind === ActionKind.Fold);
    for (let h = 0; h < 169; h++) expect(Math.abs(sol.ev[foldIdx * 169 + h])).toBeLessThan(1e-4);
  });
});
