import { describe, expect, it } from "vitest";
import { dailySeries, dayKey, heatmap, studyStreak, summarize, todayCount, weakSpots } from "../storage/stats";
import type { Attempt } from "../storage/types";
import { MemoryRepo } from "../storage/memory";

const base: Attempt = { ts: 0, sessionId: "s", mode: "spot", solution: "x", nodeId: 0, pos: "root", hand: 0, seat: 0, spot: "rfi", chosen: 0, best: 0, grade: "best", evLoss: 0, score: 100, ms: 1000, rng: false, timeout: false, hint: false };
const DAY = 86_400_000;
const noon = new Date(2026, 5, 15, 12, 0, 0).getTime();
const at = (daysAgo: number, over: Partial<Attempt> = {}): Attempt => ({ ...base, ts: noon - daysAgo * DAY, ...over });

describe("stats", () => {
  it("summarises accuracy / loss / score", () => {
    const s = summarize([at(0), at(0, { grade: "mistake", evLoss: 0.4, score: 50 }), at(0, { grade: "correct", evLoss: 0.02, score: 98 })]);
    expect(s.n).toBe(3);
    expect(s.accuracy).toBeCloseTo(2 / 3, 5);
    expect(s.avgLoss).toBeCloseTo(0.14, 5);
    expect(s.avgScore).toBeCloseTo((100 + 50 + 98) / 3, 5);
    expect(summarize([]).n).toBe(0);
  });
  it("study streak counts consecutive days, tolerating an empty today", () => {
    expect(studyStreak([at(0), at(1), at(2), at(4)], noon)).toBe(3);
    expect(studyStreak([at(1), at(2)], noon)).toBe(2);
    expect(studyStreak([at(3)], noon)).toBe(0);
  });
  it("daily series has one point per day", () => {
    const d = dailySeries([at(0), at(0), at(2, { score: 40, grade: "blunder", evLoss: 1 })], 5, noon);
    expect(d).toHaveLength(5);
    expect(d[4].n).toBe(2);
    expect(d[2].avgScore).toBe(40);
    expect(d[3].n).toBe(0);
    expect(d[4].date).toBe(dayKey(noon));
  });
  it("heat-map and weak spots", () => {
    const list = [...Array(4)].map(() => at(0, { seat: 3, spot: "vs3bet", grade: "mistake", evLoss: 0.5, score: 30 })).concat([at(0, { seat: 0, spot: "rfi" })]);
    const h = heatmap(list);
    expect(h).toHaveLength(2);
    const weak = weakSpots(list, 3);
    expect(weak).toHaveLength(1);
    expect(weak[0]).toMatchObject({ seat: 3, spot: "vs3bet", n: 4 });
    expect(todayCount(list, noon)).toBe(5);
  });
  it("repository stores, exports and merges imports", async () => {
    const a = new MemoryRepo();
    await a.addAttempt(at(0));
    await a.setMeta("k", 5);
    const blob = await a.exportAll();
    const b = new MemoryRepo();
    await b.importAll(blob);
    expect((await b.allAttempts()).length).toBe(1);
    expect(await b.getMeta("k")).toBe(5);
  });
});
