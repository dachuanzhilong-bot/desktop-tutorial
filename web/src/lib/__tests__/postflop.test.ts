import { describe, expect, it } from "vitest";
import { classify, matchesCategory } from "../postflop/categories";
import { COMBOS, COMBOS_OF_CLASS, NC, parseBoard, parseCard, classOfCards } from "../postflop/combos";
import { textureOf } from "../postflop/texture";
import { classInfo } from "../poker/hands";

const info = (board: string, h1: string, h2: string) => classify(parseBoard(board), parseCard(h1), parseCard(h2));

describe("combos", () => {
  it("enumerates 1326 combos in the solver's order", () => {
    expect(COMBOS).toHaveLength(NC);
    expect(COMBOS[0]).toMatchObject({ c1: 0, c2: 1 });
    expect(COMBOS[NC - 1]).toMatchObject({ c1: 50, c2: 51 });
    expect(COMBOS_OF_CLASS.reduce((s, l) => s + l.length, 0)).toBe(NC);
    COMBOS_OF_CLASS.forEach((l, c) => expect(l.length).toBe(classInfo(c).combos));
  });
  it("maps combos onto the 13x13 chart", () => {
    expect(classInfo(classOfCards(parseCard("As"), parseCard("Ah"))).name).toBe("AA");
    expect(classInfo(classOfCards(parseCard("Ks"), parseCard("As"))).name).toBe("AKs");
    expect(classInfo(classOfCards(parseCard("Kd"), parseCard("As"))).name).toBe("AKo");
  });
});

describe("hand classification", () => {
  it("made hands", () => {
    expect(info("Ks 7d 2c", "Kh", "Qd").made).toBe("toppair");
    expect(info("Ks 7d 2c", "7h", "Qd").made).toBe("secondpair");
    expect(info("Ks 7d 2c", "3h", "2d").made).toBe("lowpair");
    expect(info("Ks 7d 2c", "Ah", "Ad").made).toBe("overpair");
    expect(info("Ks 7d 2c", "9h", "9d").made).toBe("secondpair"); // under the king, over the seven
    expect(info("Ks 7d 2c", "7h", "7s").made).toBe("set");
    expect(info("Ks 7d 7c", "7h", "Qs").made).toBe("set"); // trips with a hole card
    expect(info("Ks 7d 2c", "Kh", "7s").made).toBe("twopair");
    expect(info("Ks Kd 2c", "2h", "Qd").made).toBe("twopair"); // board pair + deuce pair
    expect(info("Ks Kd 2c", "Ah", "Qd").made).toBe("nopair");
    expect(info("Ks 7d 2c", "Ah", "Qd").made).toBe("nopair");
    expect(info("9s 8d 7c", "Th", "6d").made).toBe("straight");
    expect(info("Ks 7s 2s", "Ah", "3s").made).toBe("nopair");
    expect(info("Ks 7s 2s 9s Jd", "As", "3h").made).toBe("flush");
    expect(info("Ks 7s 2c", "Kh", "Kd").made).toBe("set");
  });
  it("draws", () => {
    const fd = info("Ks 7s 2c", "As", "3s");
    expect(fd.flushDraw).toBe(true);
    const oesd = info("9s 8d 2c", "Th", "7d");
    expect(oesd.oesd).toBe(true);
    const gut = info("9s 8d 2c", "Th", "6d");
    expect(gut.gutshot || gut.oesd).toBe(true);
    expect(info("Ks 7d 2c", "Ah", "Qd").flushDraw).toBe(false);
    // no draws on the river
    expect(info("Ks 7s 2c 3d 9h", "As", "4s").flushDraw).toBe(false);
  });
  it("filters", () => {
    expect(matchesCategory(info("Ks 7d 2c", "7h", "7s"), "strong")).toBe(true);
    expect(matchesCategory(info("Ks 7d 2c", "Kh", "Qd"), "toppair")).toBe(true);
    expect(matchesCategory(info("Ks 7d 2c", "Ah", "Qd"), "air")).toBe(true);
    expect(matchesCategory(info("Ks 7s 2c", "As", "3s"), "flushdraw")).toBe(true);
    expect(matchesCategory(info("Ks 7s 2c", "As", "3s"), "air")).toBe(false);
  });
});

describe("board texture", () => {
  it("classifies", () => {
    expect(textureOf(parseBoard("As 7d 2c"))).toMatchObject({ high: "A", paired: false, suit: "rainbow", connect: "dry" });
    expect(textureOf(parseBoard("9h 8h 4c"))).toMatchObject({ high: "low", suit: "twotone", connect: "wet" });
    expect(textureOf(parseBoard("Ks Kd 5c"))).toMatchObject({ high: "K", paired: true });
    expect(textureOf(parseBoard("Td 9d 8d"))).toMatchObject({ suit: "monotone", connect: "wet", high: "T" });
  });
});
