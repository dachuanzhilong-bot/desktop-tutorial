import { describe, expect, it } from "vitest";
import { dueReview, parseSrsKey, REVIEW_ROUND } from "../practice/review";
import { srsKey } from "../practice/srs";
import type { SrsItem } from "../practice/srs";

const NOW = 1_800_000_000_000;
const item = (key: string, over: Partial<SrsItem> = {}): SrsItem => ({ key, nodeId: 0, hand: 0, box: 1, due: NOW - 1000, seen: 1, lapses: 0, lastGrade: "mistake", updated: NOW - 5000, ...over });

describe("review queue", () => {
  it("reads the keys the practice screens write", () => {
    expect(parseSrsKey(srsKey("cash6max-100bb", 12, 3))).toEqual({ solution: "cash6max-100bb", nodeId: 12, hand: 3 });
    expect(parseSrsKey(srsKey(undefined, 12, 3))).toEqual({ solution: "cash6max-100bb", nodeId: 12, hand: 3 });
    expect(parseSrsKey(srsKey("cash6max-40bb", 7, 168))).toEqual({ solution: "cash6max-40bb", nodeId: 7, hand: 168 });
    expect(parseSrsKey("p:srp-btn-bb/3:12:400")).toBeNull(); // post-flop
    expect(parseSrsKey("garbage")).toBeNull();
    expect(parseSrsKey("12:")).toBeNull();
  });

  it("counts only what is due, per depth, and leaves post-flop alone", () => {
    const q = dueReview(
      [
        item("1:5"),
        item("2:5"),
        item("3:5", { due: NOW + 60_000 }), // not due yet
        item("cash6max-40bb:1:9"),
        item("p:srp-btn-bb/0:1:100"), // post-flop
        item("5:999"), // not a hand class
      ],
      NOW,
    );
    expect(q.total).toBe(3);
    expect(q.groups.map((g) => [g.solution, g.due])).toEqual([["cash6max-100bb", 2], ["cash6max-40bb", 1]]);
    expect(q.groups[0].items).toHaveLength(2);
  });

  it("asks the longest overdue and most often missed first, and at most one round", () => {
    const list = Array.from({ length: 30 }, (_, i) => item(`${i}:1`, { due: NOW - 1000 * (i + 1), lapses: i % 3 }));
    const q = dueReview(list, NOW);
    const g = q.groups[0];
    expect(g.due).toBe(30);
    expect(g.items).toHaveLength(REVIEW_ROUND);
    expect(g.items[0].nodeId).toBe(29); // the longest overdue
    expect(dueReview(list, NOW, 5).groups[0].items).toHaveLength(5);
    // same due time: the one missed more often comes first
    const tie = dueReview([item("1:1", { lapses: 0 }), item("2:1", { lapses: 4 })], NOW);
    expect(tie.groups[0].items.map((x) => x.nodeId)).toEqual([2, 1]);
  });

  it("is empty when nothing is due", () => {
    expect(dueReview([], NOW)).toEqual({ total: 0, groups: [] });
    expect(dueReview([item("1:1", { due: NOW + 1 })], NOW).total).toBe(0);
  });
});
