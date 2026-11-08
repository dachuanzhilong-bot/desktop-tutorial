import { describe, expect, it } from "vitest";
import { classByName, ALL_CLASSES } from "../poker/hands";
import { compareRanges, expandToCombos, expandToken, formatRange, parseRange, rangeCombos, rangePercent } from "../ranges/range";
import { RANGE_PRESETS, findNode } from "../ranges/presets";
import { loadManifest, loadNode } from "./helpers";
import { ActionKind } from "../solution/types";
import type { SolutionStore } from "../solution/loader";

const names = (r: ArrayLike<number>) => ALL_CLASSES.filter((c) => r[c.id] > 0).map((c) => c.name);

describe("range text format", () => {
  it("expands plus and dash notation", () => {
    expect(expandToken("QQ+")!.map((c) => ALL_CLASSES[c].name).sort()).toEqual(["AA", "KK", "QQ"]);
    expect(expandToken("A5s+")!.map((c) => ALL_CLASSES[c].name).sort()).toEqual(["A5s", "A6s", "A7s", "A8s", "A9s", "AJs", "AKs", "AQs", "ATs"].sort());
    expect(expandToken("ATo+")!.map((c) => ALL_CLASSES[c].name).sort()).toEqual(["AJo", "AKo", "AQo", "ATo"]);
    expect(expandToken("JTs-87s")!.map((c) => ALL_CLASSES[c].name).sort()).toEqual(["87s", "98s", "JTs", "T9s"]);
    expect(expandToken("77-55")!.map((c) => ALL_CLASSES[c].name).sort()).toEqual(["55", "66", "77"]);
    expect(expandToken("A5s-A2s")!.map((c) => ALL_CLASSES[c].name).sort()).toEqual(["A2s", "A3s", "A4s", "A5s"]);
    expect(expandToken("AK")!.map((c) => ALL_CLASSES[c].name).sort()).toEqual(["AKo", "AKs"]);
    expect(expandToken("XYZ")).toBeNull();
    expect(expandToken("AAs")).toBeNull();
  });
  it("parses weights and reports errors", () => {
    const { range, errors } = parseRange("AA, KK:0.5, AKs:50%, QJo:25, bogus, 72s:abc");
    expect(range[classByName("AA")]).toBe(1);
    expect(range[classByName("KK")]).toBeCloseTo(0.5);
    expect(range[classByName("AKs")]).toBeCloseTo(0.5);
    expect(range[classByName("QJo")]).toBeCloseTo(0.25);
    expect(errors).toEqual(["bogus", "72s:abc"]);
    expect(rangeCombos(parseRange("AA").range)).toBe(6);
    expect(rangeCombos(parseRange("AKs,AKo").range)).toBe(16);
    expect(rangePercent(parseRange("22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q2o+,J2o+,T2o+,92o+,82o+,72o+,62o+,52o+,42o+,32o").range)).toBeCloseTo(100, 5);
  });
  it("round-trips through the compact format", () => {
    const text = "TT+,99-66:0.5,AKs-ATs,A5s-A2s,KQs:0.75,76s-54s,AQo+,JTo";
    const a = parseRange(text).range;
    const out = formatRange(a);
    const b = parseRange(out).range;
    expect(names(b).sort()).toEqual(names(a).sort());
    for (const c of ALL_CLASSES) expect(b[c.id]).toBeCloseTo(a[c.id], 3);
    expect(out).toContain("TT+");
    expect(out).toContain("ATs+");
    // random ranges survive the round trip
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 20; k++) {
      const r = new Float32Array(169);
      for (let i = 0; i < 169; i++) r[i] = rnd() < 0.3 ? [1, 0.5, 0.25][Math.floor(rnd() * 3)] : 0;
      const back = parseRange(formatRange(r)).range;
      for (let i = 0; i < 169; i++) expect(back[i]).toBeCloseTo(r[i], 3);
    }
  });
  it("expands to the solver's 1326 combos", () => {
    const v = expandToCombos(parseRange("AA,AKs:0.5").range);
    expect(v).toHaveLength(1326);
    expect(v.reduce((s, x) => s + x, 0)).toBeCloseTo(6 + 4 * 0.5, 5);
  });
  it("scores a range against a reference", () => {
    const ref = parseRange("TT+,AKs,AKo").range;
    expect(compareRanges(ref, ref).score).toBe(100);
    const tighter = parseRange("JJ+,AKs").range;
    const c = compareRanges(tighter, ref);
    expect(c.score).toBeGreaterThan(40);
    expect(c.score).toBeLessThan(100);
    expect(c.missing).toBeGreaterThan(0);
    expect(c.extra).toBe(0);
    expect(compareRanges(parseRange("72o").range, ref).score).toBe(0);
  });
});

describe("range presets from the preflop solution", () => {
  const m = loadManifest();
  it("every preset line exists in the solution and yields a plausible range", async () => {
    const store = { manifest: m, node: async (id: number) => loadNode(m, id) } as unknown as SolutionStore;
    const { presetRange } = await import("../ranges/presets");
    const pct: Record<string, number> = {};
    for (const p of RANGE_PRESETS) {
      expect(findNode(store, p.path), p.id).not.toBeNull();
      const r = await presetRange(store, p);
      expect(r, p.id).not.toBeNull();
      pct[p.id] = rangePercent(r!);
      expect(pct[p.id]).toBeGreaterThan(1);
    }
    // the widths match the preflop study numbers
    expect(pct["utg-open"]).toBeGreaterThan(12);
    expect(pct["utg-open"]).toBeLessThan(20);
    expect(pct["btn-open"]).toBeGreaterThan(pct["co-open"]);
    expect(pct["bb-call-btn"]).toBeGreaterThan(pct["bb-call-utg"]);
    expect(ActionKind.Call).toBe(1);
  });
});
