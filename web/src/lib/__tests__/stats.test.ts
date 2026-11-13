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
  it("repository reads a range of times and the records after an id, like the IndexedDB ranges", async () => {
    const r = new MemoryRepo();
    // ids 1..6; times out of order (a backup read, a row pulled by sync), two at the same time
    for (const d of [3, 1, 2, 5, 2, 0]) await r.addAttempt(at(d, { hand: d }));
    const all = await r.allAttempts();
    expect(all.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await r.countAttempts()).toBe(6);
    // ts >= the given one, oldest first, equal times in id order
    expect((await r.attemptsSince(noon - 2 * DAY)).map((a) => a.id)).toEqual([3, 5, 2, 6]);
    expect((await r.attemptsSince(noon - 2 * DAY + 1)).map((a) => a.id)).toEqual([2, 6]);
    expect((await r.attemptsSince(-Infinity)).map((a) => a.id)).toEqual([4, 1, 3, 5, 2, 6]);
    expect(await r.attemptsSince(noon + 1)).toEqual([]);
    // id > the given one, in id order
    expect((await r.attemptsAfterId(0)).map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await r.attemptsAfterId(4)).map((a) => a.id)).toEqual([5, 6]);
    expect(await r.attemptsAfterId(6)).toEqual([]);
    expect(await r.attemptsAfterId(4)).toEqual(all.slice(4));
    // after clear() ids go on (as IndexedDB's key generator does)
    await r.clear();
    expect(await r.countAttempts()).toBe(0);
    expect(await r.attemptsSince(-Infinity)).toEqual([]);
    await r.addAttempt(at(0));
    expect((await r.attemptsAfterId(0)).map((a) => a.id)).toEqual([7]);
    expect((await r.attemptsSince(noon)).map((a) => a.id)).toEqual([7]);
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
