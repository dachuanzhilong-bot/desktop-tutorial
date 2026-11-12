import { describe, expect, it } from "vitest";
import { dueReview, REVIEW_ROUND } from "../practice/review";
import { posSrsKey } from "../practice/srs";
import type { SrsItem } from "../practice/srs";

const NOW = 1_800_000_000_000;
/** an item of the pre-flop decision `pos` of `solution` (the stored node id is not what a review goes by) */
const item = (pos: string, hand: number, over: Partial<SrsItem> = {}): SrsItem => {
  const solution = over.solution ?? "cash6max-100bb";
  return { key: posSrsKey(solution, pos, hand), solution, pos, nodeId: 99_999, hand, box: 1, due: NOW - 1000, seen: 1, lapses: 0, lastGrade: "mistake", updated: NOW - 5000, ...over };
};

describe("review queue", () => {
  it("counts only what is due, per depth, and leaves post-flop alone", () => {
    const q = dueReview(
      [
        item("F", 5),
        item("F-F", 5),
        item("F-F-F", 5, { due: NOW + 60_000 }), // not due yet
        item("F", 9, { solution: "cash6max-40bb" }),
        item("9s6d3c@root", 100, { solution: "post:srp-btn-bb" }), // post-flop
        item("F-F-F-F", 999), // not a hand class
        item("root", 5, { solution: "something-else" }),
      ],
      NOW,
    );
    expect(q.total).toBe(3);
    expect(q.groups.map((g) => [g.solution, g.due])).toEqual([["cash6max-100bb", 2], ["cash6max-40bb", 1]]);
    expect(q.groups[0].items).toHaveLength(2);
    // a question is the position key and the hand
    expect(q.groups[1].items).toEqual([{ pos: "F", hand: 9 }]);
  });

  it("asks the longest overdue and most often missed first, and at most one round", () => {
    const list = Array.from({ length: 30 }, (_, i) => item(`F-R${i}`, 1, { due: NOW - 1000 * (i + 1), lapses: i % 3 }));
    const q = dueReview(list, NOW);
    const g = q.groups[0];
    expect(g.due).toBe(30);
    expect(g.items).toHaveLength(REVIEW_ROUND);
    expect(g.items[0].pos).toBe("F-R29"); // the longest overdue
    expect(dueReview(list, NOW, 5).groups[0].items).toHaveLength(5);
    // same due time: the one missed more often comes first
    const tie = dueReview([item("F-R1", 1, { lapses: 0 }), item("F-R2", 1, { lapses: 4 })], NOW);
    expect(tie.groups[0].items.map((x) => x.pos)).toEqual(["F-R2", "F-R1"]);
  });

  it("is empty when nothing is due", () => {
    expect(dueReview([], NOW)).toEqual({ total: 0, groups: [] });
    expect(dueReview([item("F", 1, { due: NOW + 1 })], NOW).total).toBe(0);
  });
});
