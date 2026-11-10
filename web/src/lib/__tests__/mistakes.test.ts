import { describe, expect, it } from "vitest";
import { handLabel, recentMistakes, studyHref } from "../storage/mistakes";
import type { Attempt } from "../storage/types";
import { classByName } from "../poker/hands";
import { COMBOS, parseCard } from "../postflop/combos";

const att = (o: Partial<Attempt>): Attempt => ({
  ts: 1,
  sessionId: "s",
  mode: "spot",
  solution: "cash6max-100bb",
  nodeId: 0,
  hand: 0,
  seat: 0,
  spot: "rfi",
  chosen: 0,
  best: 1,
  grade: "mistake",
  evLoss: 0.4,
  score: 20,
  ms: 900,
  rng: false,
  timeout: false,
  hint: false,
  ...o,
});

describe("mistake notebook", () => {
  it("keeps only big mistakes, newest first, one per position and hand, up to the limit", () => {
    const list = [
      att({ ts: 5, nodeId: 3, hand: 10, grade: "blunder" }),
      att({ ts: 1, nodeId: 3, hand: 10, grade: "mistake" }), // the same spot, older: dropped
      att({ ts: 9, nodeId: 4, hand: 11, grade: "inaccurate" }), // not big enough
      att({ ts: 8, nodeId: 5, hand: 12, grade: "best" }),
      att({ ts: 7, nodeId: 6, hand: 13, grade: "mistake", solution: "cash6max-40bb" }), // same node id, another depth: its own entry
      att({ ts: 6, nodeId: 6, hand: 13, grade: "mistake" }),
    ];
    expect(recentMistakes(list).map((a) => [a.ts, a.nodeId])).toEqual([[7, 6], [6, 6], [5, 3]]);
    expect(recentMistakes(list, 2)).toHaveLength(2);
    expect(recentMistakes([])).toEqual([]);
    expect(list[0].ts).toBe(5); // the input is left as it was
  });

  it("links to the position in the Study screen", () => {
    expect(studyHref(att({ solution: "cash6max-100bb", nodeId: 12, hand: classByName("AKs") }))).toBe(`/study/#d=100&n=12&h=${classByName("AKs")}`);
    expect(studyHref(att({ solution: "cash6max-20bb", nodeId: 0, hand: 0 }))).toBe("/study/#d=20&n=0&h=0");
    expect(studyHref(att({ solution: "post:srp-btn-bb/3", nodeId: 7, hand: 100, mode: "postSpot" }))).toBe("/study/postflop/#s=srp-btn-bb&f=3&n=7");
    expect(studyHref(att({ solution: "something-else" }))).toBeNull();
    expect(studyHref(att({ solution: "" }))).toBeNull();
  });

  it("names the hand", () => {
    expect(handLabel(att({ hand: classByName("AKs") }))).toBe("AKs");
    expect(handLabel(att({ hand: classByName("77") }))).toBe("77");
    const i = COMBOS.findIndex((c) => c.c1 === parseCard("2c") && c.c2 === parseCard("Ah"));
    expect(handLabel(att({ solution: "post:srp-btn-bb/0", hand: i }))).toBe("2cAh");
    expect(handLabel(att({ hand: 999 }))).toBe("");
    expect(handLabel(att({ solution: "post:srp-btn-bb/0", hand: 99999 }))).toBe("");
  });
});
