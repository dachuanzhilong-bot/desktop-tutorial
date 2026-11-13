import { describe, expect, it } from "vitest";
import { recentMistakes } from "../storage/mistakes";
import { MemoryRepo } from "../storage/memory";
import { dailySeries, heatmap, studyStreak, summarize, todayCount, weakSpots } from "../storage/stats";
import { buildStats, emptyStats, loadHome, loadStats, STATS_CACHE_KEY, statsHeatmap, statsMistakes, statsSeries, statsStreak, statsSummary, statsToday, statsWeakSpots } from "../storage/statsCache";
import type { StatsCache } from "../storage/statsCache";
import type { Attempt } from "../storage/types";
import { randomAttempt, randomHistory, rng } from "./attemptGen";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 25, 15, 30).getTime();

/** a MemoryRepo that counts the reads of every record */
class CountingRepo extends MemoryRepo {
  fullReads = 0;
  async allAttempts() {
    this.fullReads++;
    return super.allAttempts();
  }
}

/** what the stats screen and the home screen show, made from the totals and from the list of every record, must agree exactly */
function expectSameAsFull(c: StatsCache, list: Attempt[], now = NOW) {
  expect(statsSummary(c)).toEqual(summarize(list));
  expect(statsSeries(c, 30, now)).toEqual(dailySeries(list, 30, now));
  expect(statsSeries(c, 400, now)).toEqual(dailySeries(list, 400, now));
  expect(statsHeatmap(c)).toEqual(heatmap(list));
  expect(statsWeakSpots(c, 3, 5)).toEqual(weakSpots(list, 3, 5));
  expect(statsWeakSpots(c, 3, 2)).toEqual(weakSpots(list, 3, 2));
  expect(statsStreak(c, now)).toBe(studyStreak(list, now));
  expect(statsToday(c, now)).toBe(todayCount(list, now));
  expect(statsMistakes(c)).toEqual(recentMistakes(list));
  const grades = { best: 0, correct: 0, inaccurate: 0, mistake: 0, blunder: 0 };
  for (const a of list) grades[a.grade]++;
  expect(c.grades).toEqual(grades);
  // and the totals themselves are what a rebuild from every record gives
  expect(c).toEqual(buildStats(list));
}

describe("stats totals (meta stats.daily.v1): updated one record at a time = made again from every record", () => {
  it.each([1, 2, 3])("random answers over many days, pre-flop and post-flop mixed, some recorded late (seed %i)", async (seed) => {
    const r = rng(seed);
    const repo = new CountingRepo();
    let ts = NOW - 40 * DAY;
    let reads = 0;
    // a new device: the first read makes the (empty) totals
    await loadStats(repo);
    repo.fullReads = 0;
    while (ts < NOW) {
      // a burst of answers (one or several before the totals are read), hours apart, so days are crossed often
      const burst = 1 + Math.floor(r() * 4);
      for (let i = 0; i < burst; i++) {
        ts += Math.floor(r() * 3 * 3_600_000);
        // now and then a record with an older time (a backup read, a row pulled by sync)
        const at = r() < 0.08 ? ts - Math.floor(r() * 20 * DAY) : ts;
        await repo.addAttempt(randomAttempt(r, at));
      }
      await loadStats(repo);
      reads++;
    }
    const all = await repo.allAttempts();
    expect(all.length).toBeGreaterThan(300);
    const c = await loadStats(repo);
    expect(repo.fullReads).toBe(1); // the line above; the totals themselves never read every record
    expect(reads).toBeGreaterThan(100);
    expectSameAsFull(c, all);
    expect(await repo.getMeta(STATS_CACHE_KEY)).toEqual(c);
    // the same at other moments: start of the day, a day with nothing yet, after a gap
    for (const now of [NOW - 15 * 3_600_000, NOW + DAY, NOW + 5 * DAY]) expectSameAsFull(c, all, now);
  });

  it("several answers at the same millisecond keep the notebook order of the full list", async () => {
    const repo = new MemoryRepo();
    const r = rng(9);
    for (let i = 0; i < 60; i++) {
      await repo.addAttempt({ ...randomAttempt(r, NOW - (i % 3) * 1000), grade: i % 2 ? "mistake" : "blunder" });
      if (i % 7 === 0) await loadStats(repo);
    }
    expectSameAsFull(await loadStats(repo), await repo.allAttempts());
  });

  it("no records: empty totals, the same as before", async () => {
    const repo = new MemoryRepo();
    const c = await loadStats(repo);
    expect(c.n).toBe(0);
    expectSameAsFull(c, []);
  });
});

describe("stats totals: when the saved copy is old", () => {
  async function seeded(n = 500) {
    const repo = new CountingRepo();
    for (const a of randomHistory(4, n, NOW, 60)) await repo.addAttempt(a);
    return repo;
  }

  it("a device that recorded before the totals existed: made from every record once, then kept up to date", async () => {
    const repo = await seeded();
    expect(await repo.getMeta(STATS_CACHE_KEY)).toBeUndefined();
    const c = await loadStats(repo);
    expect(repo.fullReads).toBe(1);
    expectSameAsFull(c, await repo.allAttempts());
    expect(await repo.getMeta(STATS_CACHE_KEY)).toEqual(c);
    // later answers are added without reading everything again
    for (const a of randomHistory(5, 30, NOW + DAY, 1)) await repo.addAttempt(a);
    const before = repo.fullReads;
    const c2 = await loadStats(repo);
    expect(repo.fullReads).toBe(before);
    expectSameAsFull(c2, await repo.allAttempts(), NOW + DAY);
  });

  const cases: [string, (c: StatsCache) => unknown][] = [
    ["not an object", () => "garbage"],
    ["another version", (c) => ({ ...c, v: 2 })],
    ["made in another time zone (day keys are local days)", (c) => ({ ...c, tz: "Pacific/Chatham-not-this-one" })],
    ["missing fields", (c) => ({ ...c, days: undefined })],
    ["a sum that is not a number", (c) => ({ ...c, total: { ...c.total, loss: "x" } })],
    // the copy counts more records than there are: some were deleted (the upgrade that drops the old format, another tab's clear)
    ["counts records that were deleted", (c) => ({ ...c, n: c.n + 7 })],
    // two tabs saved it at once: the last one wrote a copy that misses the other tab's record
    ["missed a record of another tab", (c) => ({ ...c, n: c.n - 1 })],
  ];
  it.each(cases)("%s: made again from every record", async (_name, spoil) => {
    const repo = await seeded();
    const good = await loadStats(repo);
    await repo.setMeta(STATS_CACHE_KEY, spoil(structuredClone(good)));
    const reads = repo.fullReads;
    const c = await loadStats(repo);
    expect(repo.fullReads).toBe(reads + 1);
    expectSameAsFull(c, await repo.allAttempts());
  });

  it("another tab saved an older copy: the records after it are added, nothing read twice", async () => {
    const repo = await seeded(200);
    const old = structuredClone(await loadStats(repo));
    for (const a of randomHistory(6, 50, NOW, 3)) await repo.addAttempt(a);
    await loadStats(repo);
    await repo.setMeta(STATS_CACHE_KEY, old);
    const reads = repo.fullReads;
    const c = await loadStats(repo);
    expect(repo.fullReads).toBe(reads);
    expectSameAsFull(c, await repo.allAttempts());
  });

  it("clear(): empty totals", async () => {
    const repo = await seeded(50);
    await loadStats(repo);
    await repo.clear();
    expectSameAsFull(await loadStats(repo), []);
    await repo.addAttempt(randomHistory(7, 1, NOW, 1)[0]);
    expectSameAsFull(await loadStats(repo), await repo.allAttempts());
  });

  it("a backup leaves the totals out; reading one adds its records and never takes totals from the file", async () => {
    const a = await seeded(120);
    await loadStats(a);
    const blob = await a.exportAll();
    expect(Object.keys(blob.meta)).not.toContain(STATS_CACHE_KEY);

    const b = new CountingRepo();
    for (const x of randomHistory(8, 40, NOW, 10)) await b.addAttempt(x);
    await loadStats(b);
    // a file written by hand (or by a later version) with totals in it: they would not match this device's records
    await b.importAll({ ...blob, meta: { ...blob.meta, [STATS_CACHE_KEY]: { ...emptyStats(), n: 999_999 }, other: 1 } });
    expect(await b.getMeta("other")).toBe(1);
    const reads = b.fullReads;
    const c = await loadStats(b);
    expect(b.fullReads).toBe(reads); // the imported records are new ids: added on top
    expectSameAsFull(c, await b.allAttempts());
  });

  it("loadStats calls in a row (two answers saved quickly) do not count a record twice", async () => {
    const repo = await seeded(100);
    await loadStats(repo);
    const r = rng(11);
    const all: Promise<StatsCache>[] = [];
    for (let i = 0; i < 20; i++) {
      await repo.addAttempt(randomAttempt(r, NOW + i));
      all.push(loadStats(repo));
    }
    await Promise.all(all);
    expectSameAsFull(await loadStats(repo), await repo.allAttempts(), NOW + 1000);
  });

  it("a copy that cannot be saved is still shown, and the next read catches up", async () => {
    const repo = await seeded(80);
    const failing = Object.assign(Object.create(repo) as MemoryRepo, { setMeta: () => Promise.reject(new Error("quota")) });
    expectSameAsFull(await loadStats(failing), await repo.allAttempts());
    expect(await repo.getMeta(STATS_CACHE_KEY)).toBeUndefined();
    expectSameAsFull(await loadStats(repo), await repo.allAttempts());
  });
});

describe("home screen data", () => {
  it("today's records come from a range of times; streak and weak spots from the totals", async () => {
    const repo = new CountingRepo();
    const list = randomHistory(12, 800, NOW, 20);
    for (const a of list) await repo.addAttempt(a);
    await loadStats(repo);
    const reads = repo.fullReads;
    const h = await loadHome(repo, NOW);
    expect(repo.fullReads).toBe(reads);
    const all = await repo.allAttempts();
    expect(todayCount(h.recent, NOW)).toBe(todayCount(all, NOW));
    expect(h.recent.length).toBe(todayCount(all, NOW));
    expect(statsStreak(h.stats, NOW)).toBe(studyStreak(all, NOW));
    expect(statsWeakSpots(h.stats, 3, 2)).toEqual(weakSpots(all, 3, 2));
  });
});
