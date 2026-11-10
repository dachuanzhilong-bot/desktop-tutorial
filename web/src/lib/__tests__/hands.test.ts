import { describe, expect, it } from "vitest";
import { ALL_CLASSES, classByName, classCombos, classInfo, matchesFilter, holdsRank } from "../poker/hands";

describe("hand classes", () => {
  it("has 169 classes covering 1326 combos", () => {
    expect(ALL_CLASSES).toHaveLength(169);
    expect(ALL_CLASSES.reduce((s, c) => s + c.combos, 0)).toBe(1326);
    for (const c of ALL_CLASSES) expect(classCombos(c.id)).toHaveLength(c.combos);
  });
  it("follows the usual chart layout", () => {
    expect(classInfo(0).name).toBe("AA");
    expect(classInfo(1).name).toBe("AKs"); // suited above the diagonal
    expect(classInfo(13).name).toBe("AKo"); // offsuit below
    expect(classInfo(168).name).toBe("22");
    expect(classByName("T9s")).toBe(4 * 13 + 5);
  });
  it("combos are distinct and have the right suit structure", () => {
    const suited = classCombos(classByName("QJs"));
    expect(suited.every(([a, b]) => a.suit === b.suit)).toBe(true);
    const off = classCombos(classByName("QJo"));
    expect(off.every(([a, b]) => a.suit !== b.suit)).toBe(true);
    const keys = new Set(classCombos(classByName("77")).map(([a, b]) => a.suit + b.suit));
    expect(keys.size).toBe(6);
  });
  it("filters", () => {
    expect(matchesFilter(classByName("AKs"), "suitedAces")).toBe(true);
    expect(matchesFilter(classByName("AKo"), "suitedAces")).toBe(false);
    expect(matchesFilter(classByName("98s"), "suitedConnectors")).toBe(true);
    expect(matchesFilter(classByName("97s"), "suitedGappers")).toBe(true);
    expect(matchesFilter(classByName("KQo"), "broadway")).toBe(true);
    expect(matchesFilter(classByName("AA"), "broadway")).toBe(false);
    expect(matchesFilter(classByName("TT"), "bigPairs")).toBe(true);
    expect(matchesFilter(classByName("99"), "smallPairs")).toBe(true);
    expect(holdsRank(classByName("A5s"), 0)).toBe(true);
    expect(holdsRank(classByName("KQo"), 0)).toBe(false);
  });
});
