/**
 * REFACTOR_PLAN step 2-7, completion condition: with 50,000 records the home screen and the stats screen get what they
 * show in at most twice the time they take with 10,000.
 *
 * The repository is a MemoryRepo that hands out copies (structured clones) of what it stores, the way IndexedDB
 * does: reading a record costs about what it costs there, so reading every record grows with their number. (There
 * is no IndexedDB in Node and no fake one among the dev dependencies; the IndexedDB repository runs the same reads
 * as ranges — lib/storage/idb.ts — and the E2E tests use it.)
 *
 * Timing: the median of many runs, after a warm-up; a time under FLOOR_MS counts as FLOOR_MS (below that the ratio is
 * noise). The same harness, run on reads of every record (what the screens did before), must fail the condition:
 * that is checked too, so the test cannot pass by measuring nothing.
 */
import { describe, expect, it } from "vitest";
import { recentMistakes } from "../storage/mistakes";
import { MemoryRepo } from "../storage/memory";
import { dailySeries, heatmap, studyStreak, summarize, todayCount, weakSpots } from "../storage/stats";
import { loadHome, loadStats, statsHeatmap, statsMistakes, statsSeries, statsStreak, statsSummary, statsToday, statsWeakSpots } from "../storage/statsCache";
import type { Attempt } from "../storage/types";
import { randomHistory } from "./attemptGen";

const NOW = new Date(2026, 9, 25, 15, 30).getTime();
const FLOOR_MS = 2;
const RUNS = 15;

/** a MemoryRepo that, like IndexedDB, gives out copies */
class CloningRepo extends MemoryRepo {
  async allAttempts() {
    return structuredClone(await super.allAttempts());
  }
  async attemptsSince(ts: number) {
    return structuredClone(await super.attemptsSince(ts));
  }
  async attemptsAfterId(id: number) {
    return structuredClone(await super.attemptsAfterId(id));
  }
  async getMeta<T>(key: string) {
    return structuredClone(await super.getMeta<T>(key));
  }
  async setMeta<T>(key: string, value: T) {
    await super.setMeta(key, structuredClone(value));
  }
}

async function filled(n: number) {
  const repo = new CloningRepo();
  // the same year of practice, more or less often (pre-flop and post-flop mixed)
  for (const a of randomHistory(n, n, NOW, 365)) await repo.addAttempt(a);
  return repo;
}

/** what the home screen shows */
async function home(repo: CloningRepo) {
  const { recent, stats } = await loadHome(repo, NOW);
  return [todayCount(recent, NOW), statsStreak(stats, NOW), statsWeakSpots(stats, 3, 2)];
}

/** what the stats screen shows */
async function stats(repo: CloningRepo) {
  const c = await loadStats(repo);
  return [statsSummary(c), statsSeries(c, 30, NOW), statsHeatmap(c), statsWeakSpots(c, 3, 5), statsStreak(c, NOW), statsToday(c, NOW), statsMistakes(c), c.grades];
}

/** the same, from every record (what the two screens did before this step) */
async function homeFromAll(repo: CloningRepo) {
  const list = await repo.allAttempts();
  return [todayCount(list, NOW), studyStreak(list, NOW), weakSpots(list, 3, 2)];
}
async function statsFromAll(repo: CloningRepo) {
  const list: Attempt[] = await repo.allAttempts();
  return [summarize(list), dailySeries(list, 30, NOW), heatmap(list), weakSpots(list, 3, 5), studyStreak(list, NOW), todayCount(list, NOW), recentMistakes(list)];
}

async function medianMs(run: () => Promise<unknown>): Promise<number> {
  for (let i = 0; i < 3; i++) await run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await run();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1];
}

describe("home and stats with 10,000 and 50,000 records", () => {
  it("50,000 records take at most twice as long as 10,000 (reading every record would not)", async () => {
    const small = await filled(10_000);
    const large = await filled(50_000);
    // the totals are made once (a device that recorded before they existed); then kept up to date
    const cold: Record<string, number> = {};
    for (const [name, repo] of [["10k", small], ["50k", large]] as const) {
      const t0 = performance.now();
      await loadStats(repo);
      cold[name] = performance.now() - t0;
    }

    const t = {
      home: [await medianMs(() => home(small)), await medianMs(() => home(large))],
      stats: [await medianMs(() => stats(small)), await medianMs(() => stats(large))],
      homeFromAll: [await medianMs(() => homeFromAll(small)), await medianMs(() => homeFromAll(large))],
      statsFromAll: [await medianMs(() => statsFromAll(small)), await medianMs(() => statsFromAll(large))],
    };
    const ratio = ([a, b]: number[]) => Math.max(b, FLOOR_MS) / Math.max(a, FLOOR_MS);
    const report = Object.fromEntries(Object.entries(t).map(([k, [a, b]]) => [k, `${a.toFixed(2)}ms -> ${b.toFixed(2)}ms (x${(b / a).toFixed(2)}, judged x${ratio([a, b]).toFixed(2)})`]));
    console.info("stats/home timing", { ...report, coldBuild: `${cold["10k"].toFixed(0)}ms -> ${cold["50k"].toFixed(0)}ms` });

    expect(ratio(t.home)).toBeLessThanOrEqual(2);
    expect(ratio(t.stats)).toBeLessThanOrEqual(2);
    // the harness sees the difference: reading every record grows with their number
    expect(ratio(t.homeFromAll)).toBeGreaterThan(2);
    expect(ratio(t.statsFromAll)).toBeGreaterThan(2);
  }, 120_000);
});
