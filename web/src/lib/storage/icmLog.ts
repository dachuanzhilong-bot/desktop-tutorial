import { GRADES, isGood } from "../practice/grading";
import type { Grade } from "../practice/grading";
import type { Repo } from "./types";

/**
 * One answer in the ICM push/fold drill. The EV is in % of the prize pool, not bb, so these stay apart from the
 * chip-EV practice attempts (their averages and heat map would mean nothing mixed together).
 */
export interface IcmLogEntry {
  ts: number;
  /** players at the table */
  players: number;
  /** position of the player deciding, e.g. "BTN" */
  pos: string;
  /** that player's stack in bb */
  stack: number;
  /** the jammer's position when the decision is a call; null when first in */
  facing: string | null;
  /** hand class 0..168 */
  hand: number;
  /** 0 = fold, 1 = jam / call */
  chosen: 0 | 1;
  grade: Grade;
  /** % of the prize pool */
  evLoss: number;
  score: number;
}

/** kept in the meta store: part of the backup file, and the database schema stays as it is */
export const ICM_LOG_KEY = "icm.log";
/** newest answers kept (about 150 bytes each) */
export const ICM_LOG_MAX = 2000;

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function isEntry(x: unknown): x is IcmLogEntry {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  return (
    finite(e.ts) &&
    finite(e.players) &&
    typeof e.pos === "string" &&
    finite(e.stack) &&
    (e.facing === null || typeof e.facing === "string") &&
    Number.isInteger(e.hand) &&
    (e.hand as number) >= 0 &&
    (e.hand as number) < 169 &&
    (e.chosen === 0 || e.chosen === 1) &&
    GRADES.includes(e.grade as Grade) &&
    finite(e.evLoss) &&
    finite(e.score)
  );
}

/** the valid entries of a stored or imported value (anything else is dropped) */
export function sanitizeIcmLog(v: unknown): IcmLogEntry[] {
  return Array.isArray(v) ? v.filter(isEntry) : [];
}

/** union of two logs (same time, hand and answer = the same entry), oldest first, the newest ICM_LOG_MAX kept */
export function mergeIcmLog(a: unknown, b: unknown): IcmLogEntry[] {
  const seen = new Set<string>();
  const out: IcmLogEntry[] = [];
  for (const e of [...sanitizeIcmLog(a), ...sanitizeIcmLog(b)]) {
    const k = `${e.ts}:${e.hand}:${e.chosen}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  out.sort((x, y) => x.ts - y.ts);
  return out.slice(-ICM_LOG_MAX);
}

export async function readIcmLog(repo: Repo): Promise<IcmLogEntry[]> {
  return sanitizeIcmLog(await repo.getMeta(ICM_LOG_KEY));
}

// answers and sync merges are queued: read-modify-write never interleaves
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

export function mergeIcmLogIntoRepo(repo: Repo, incoming: unknown): Promise<IcmLogEntry[]> {
  return enqueue(async () => {
    const next = mergeIcmLog(await readIcmLog(repo), incoming);
    await repo.setMeta(ICM_LOG_KEY, next);
    return next;
  });
}

export async function appendIcmLog(repo: Repo, e: IcmLogEntry): Promise<void> {
  await mergeIcmLogIntoRepo(repo, [e]);
}

export interface IcmSummaryRow {
  n: number;
  /** share of best / correct answers, 0..1 */
  accuracy: number;
  /** mean EV loss, % of the prize pool */
  avgLoss: number;
}

export function summarizeIcm(log: IcmLogEntry[]): IcmSummaryRow & { byPos: (IcmSummaryRow & { pos: string })[] } {
  const row = (list: IcmLogEntry[]): IcmSummaryRow => ({
    n: list.length,
    accuracy: list.length ? list.filter((e) => isGood(e.grade)).length / list.length : 0,
    avgLoss: list.length ? list.reduce((s, e) => s + e.evLoss, 0) / list.length : 0,
  });
  const groups = new Map<string, IcmLogEntry[]>();
  for (const e of log) {
    const k = e.facing === null ? e.pos : `${e.pos} vs ${e.facing}`;
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  // the costliest spots first
  const byPos = [...groups].map(([pos, list]) => ({ pos, ...row(list) })).sort((a, b) => b.avgLoss - a.avgLoss || b.n - a.n);
  return { ...row(log), byPos };
}
