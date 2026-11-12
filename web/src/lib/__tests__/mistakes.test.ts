import { describe, expect, it } from "vitest";
import { handLabel, recentMistakes } from "../storage/mistakes";
import type { Attempt } from "../storage/types";
import { classByName } from "../poker/hands";
import { COMBOS, parseCard } from "../postflop/combos";

const att = (o: Partial<Attempt>): Attempt => ({
  ts: 1,
  sessionId: "s",
  mode: "spot",
  solution: "cash6max-100bb",
  nodeId: 0,
  pos: "root",
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
      att({ ts: 5, pos: "F-R2.5", hand: 10, grade: "blunder" }),
      att({ ts: 1, pos: "F-R2.5", hand: 10, grade: "mistake", nodeId: 77 }), // the same position (whatever its node id was), older: dropped
      att({ ts: 9, pos: "F-F", hand: 11, grade: "inaccurate" }), // not big enough
      att({ ts: 8, pos: "F-F-F", hand: 12, grade: "best" }),
      att({ ts: 7, pos: "F-F-R2.5", hand: 13, grade: "mistake", solution: "cash6max-40bb" }), // same line, another depth: its own entry
      att({ ts: 6, pos: "F-F-R2.5", hand: 13, grade: "mistake" }),
    ];
    expect(recentMistakes(list).map((a) => [a.ts, a.pos])).toEqual([[7, "F-F-R2.5"], [6, "F-F-R2.5"], [5, "F-R2.5"]]);
    expect(recentMistakes(list, 2)).toHaveLength(2);
    expect(recentMistakes([])).toEqual([]);
    expect(list[0].ts).toBe(5); // the input is left as it was
  });

  // the Study link of an entry (resolveStudyHref: by the position key, looked up in today's data) is tested in position.test.ts

  it("names the hand", () => {
    expect(handLabel(att({ hand: classByName("AKs") }))).toBe("AKs");
    expect(handLabel(att({ hand: classByName("77") }))).toBe("77");
    const i = COMBOS.findIndex((c) => c.c1 === parseCard("2c") && c.c2 === parseCard("Ah"));
    expect(handLabel(att({ solution: "post:srp-btn-bb/0", hand: i }))).toBe("2cAh");
    expect(handLabel(att({ hand: 999 }))).toBe("");
    expect(handLabel(att({ solution: "post:srp-btn-bb/0", hand: 99999 }))).toBe("");
  });
});
