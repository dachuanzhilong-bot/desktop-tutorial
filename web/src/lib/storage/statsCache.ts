/**
 * The totals the stats screen and the home screen show, kept in `meta["stats.daily.v1"]` (REFACTOR_PLAN step 2-7)
 * so that they do not read every practice record each time.
 *
 * It is a derived copy: the records (the `attempts` store) stay the truth. It is not exported in a backup, not taken
 * from one, and not synchronised (each device makes its own from its records).
 *
 * It counts the records with ids up to `lastId`, `n` of them. Reading it (`loadStats`):
 *  1. records saved since (`attemptsAfterId(lastId)`: this tab's answers, another tab's, a backup read, rows pulled
 *     by sync) are added to it;
 *  2. then `n` must equal the number of records. When it does not (records were deleted: the database upgrade that
 *     dropped the old format, a clear from another tab; or two tabs saved it at once), when it is missing (a device
 *     that recorded before this existed, or after `clear()`), unreadable, or made in another time zone (day keys
 *     are local days), it is made again from every record — once.
 * `recordAnswer` (lib/practice/record.ts) runs the same after each answer, so it is normally one record behind.
 *
 * Every number is the same as the one the list functions of lib/storage/stats.ts and `recentMistakes` give for all
 * records (statsCache.test.ts): sums are added in id order, as they were over `allAttempts()`.
 */
import type { Grade } from "../practice/grading";
import type { SpotType } from "../solution/types";
import { accAdd, dayKey, emptyAcc, heatCell, seriesOf, startOfDay, streakOf, summaryOf, weakestCells } from "./stats";
import type { Acc, DayPoint, HeatCell, Summary } from "./stats";
import type { Attempt, Repo } from "./types";

export const STATS_CACHE_KEY = "stats.daily.v1";

/** `meta` keys that are made from other data on this device: left out of backups (and never read from one) */
export const isDerivedMetaKey = (key: unknown) => key === STATS_CACHE_KEY;

/** how many mistakes the notebook of the stats screen lists (`recentMistakes`' default) */
export const NOTEBOOK_SIZE = 8;

export interface StatsCache {
  v: 1;
  /** the time zone the day keys were made in */
  tz: string;
  /** records counted */
  n: number;
  /** the largest id counted (0: none) */
  lastId: number;
  total: Acc;
  grades: Record<Grade, number>;
  /** per local day (`dayKey`) */
  days: Record<string, Acc>;
  /** per seat and spot, in the order of their first record */
  cells: { seat: number; spot: SpotType; acc: Acc }[];
  /** the notebook: the latest mistakes and blunders, one per solution, position and hand, newest first */
  mistakes: Attempt[];
}

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
};

export function emptyStats(): StatsCache {
  return { v: 1, tz: timeZone(), n: 0, lastId: 0, total: emptyAcc(), grades: { best: 0, correct: 0, inaccurate: 0, mistake: 0, blunder: 0 }, days: {}, cells: [], mistakes: [] };
}

const mistakeKey = (a: Attempt) => `${a.solution}:${a.pos}:${a.hand}`;
/** notebook order: newer first; at the same time the earlier saved first (what a stable sort of the id-ordered list gives) */
const before = (x: Attempt, y: Attempt) => x.ts > y.ts || (x.ts === y.ts && (x.id ?? 0) < (y.id ?? 0));

function addMistake(list: Attempt[], a: Attempt) {
  if (a.grade !== "mistake" && a.grade !== "blunder") return;
  const k = mistakeKey(a);
  const at = list.findIndex((x) => mistakeKey(x) === k);
  if (at >= 0) {
    if (!before(a, list[at])) return;
    list.splice(at, 1);
  }
  let i = 0;
  while (i < list.length && before(list[i], a)) i++;
  // a key that fell off the end was older than every listed one, so `a` (newer than it) stands for it
  if (i >= NOTEBOOK_SIZE) return;
  list.splice(i, 0, a);
  if (list.length > NOTEBOOK_SIZE) list.length = NOTEBOOK_SIZE;
}

/** adds one record; records must be added in id order */
export function addToStats(c: StatsCache, a: Attempt): void {
  c.n++;
  c.lastId = Math.max(c.lastId, a.id ?? 0);
  accAdd(c.total, a);
  if (a.grade in c.grades) c.grades[a.grade]++;
  const day = dayKey(a.ts);
  accAdd((c.days[day] ??= emptyAcc()), a);
  let cell = c.cells.find((x) => x.seat === a.seat && x.spot === a.spot);
  if (!cell) c.cells.push((cell = { seat: a.seat, spot: a.spot, acc: emptyAcc() }));
  accAdd(cell.acc, a);
  addMistake(c.mistakes, a);
}

/** the totals of `list` (in id order) made from nothing */
export function buildStats(list: Attempt[]): StatsCache {
  const c = emptyStats();
  for (const a of list) addToStats(c, a);
  return c;
}

const isAcc = (v: unknown): v is Acc => {
  const r = v as Acc | null;
  return !!r && typeof r === "object" && [r.n, r.good, r.loss, r.score].every((x) => typeof x === "number" && Number.isFinite(x));
};

/** a saved value that can be used as it is: this version, this time zone, the right shape */
function usable(v: unknown): v is StatsCache {
  const c = v as StatsCache | null;
  if (!c || typeof c !== "object" || c.v !== 1 || c.tz !== timeZone()) return false;
  if (!Number.isInteger(c.n) || !Number.isFinite(c.lastId) || !isAcc(c.total)) return false;
  if (!c.grades || typeof c.grades !== "object" || !c.days || typeof c.days !== "object") return false;
  if (!Array.isArray(c.cells) || !c.cells.every((x) => x && isAcc(x.acc)) || !Array.isArray(c.mistakes)) return false;
  return Object.values(c.days).every(isAcc);
}

/** one refresh at a time per repository (two answers in a row would otherwise both add the newer records) */
const running = new WeakMap<Repo, Promise<StatsCache>>();

/**
 * The totals of every record: the saved copy brought up to date (see the top of this file), saved again when it
 * changed. Never rejects because of the copy: a copy that cannot be read is made again.
 */
export function loadStats(repo: Repo): Promise<StatsCache> {
  const prev = running.get(repo) ?? Promise.resolve(null);
  const next = prev.catch(() => null).then(() => refresh(repo));
  running.set(repo, next);
  return next;
}

async function refresh(repo: Repo): Promise<StatsCache> {
  const saved = await repo.getMeta<unknown>(STATS_CACHE_KEY).catch(() => undefined);
  let c: StatsCache | null = null;
  let changed = false;
  if (usable(saved)) {
    const more = await repo.attemptsAfterId(saved.lastId);
    // a copy: the in-memory repository hands out the stored object itself
    c = more.length ? structuredClone(saved) : saved;
    for (const a of more) addToStats(c, a);
    changed = more.length > 0;
  }
  if (!c || c.n !== (await repo.countAttempts())) {
    c = buildStats(await repo.allAttempts());
    changed = true;
  }
  if (changed) await repo.setMeta(STATS_CACHE_KEY, c).catch(() => {});
  return c;
}

/**
 * What the home screen needs: today's records (a range of the `ts` index, from the local midnight of `now`) for the
 * count of today, and the totals for the streak and the weak spots (both over every record, as before).
 */
export async function loadHome(repo: Repo, now: number): Promise<{ recent: Attempt[]; stats: StatsCache }> {
  const [recent, stats] = await Promise.all([repo.attemptsSince(startOfDay(now)), loadStats(repo)]);
  return { recent, stats };
}

// ---- what the screens show, from the totals (the same as the list functions of lib/storage/stats.ts)

export const statsSummary = (c: StatsCache): Summary => summaryOf(c.total);

export const statsSeries = (c: StatsCache, days: number, now: number): DayPoint[] => seriesOf((k) => summaryOf(c.days[k] ?? emptyAcc()), days, now);

export const statsHeatmap = (c: StatsCache): HeatCell[] => c.cells.map((x) => heatCell(x.seat, x.spot, x.acc));

export const statsWeakSpots = (c: StatsCache, minN = 3, top = 5): HeatCell[] => weakestCells(statsHeatmap(c), minN, top);

export const statsStreak = (c: StatsCache, now: number): number => streakOf({ has: (k) => (c.days[k]?.n ?? 0) > 0 }, now);

export const statsToday = (c: StatsCache, now: number): number => c.days[dayKey(now)]?.n ?? 0;

/** the notebook (`recentMistakes(all, limit)` for limit <= NOTEBOOK_SIZE) */
export const statsMistakes = (c: StatsCache, limit = NOTEBOOK_SIZE): Attempt[] => c.mistakes.slice(0, limit);
