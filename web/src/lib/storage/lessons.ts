import { LESSONS } from "../learn/lessons";
import type { Repo } from "./types";

/** a lesson marked as done; kept in the meta store (part of the backup file, no database change) */
export interface LessonDone {
  id: string;
  ts: number;
}

export const LESSONS_KEY = "learn.done";

const known = new Set(LESSONS.map((l) => l.id));

/** the valid entries of a stored or imported value: known lessons only, one per id (the earliest time) */
export function sanitizeLessonsDone(v: unknown): LessonDone[] {
  if (!Array.isArray(v)) return [];
  const byId = new Map<string, LessonDone>();
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const e = x as Record<string, unknown>;
    if (typeof e.id !== "string" || !known.has(e.id) || typeof e.ts !== "number" || !Number.isFinite(e.ts)) continue;
    const have = byId.get(e.id);
    if (!have || e.ts < have.ts) byId.set(e.id, { id: e.id, ts: e.ts });
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

/** importing a backup keeps what both sides have finished */
export const mergeLessonsDone = (a: unknown, b: unknown): LessonDone[] => sanitizeLessonsDone([...sanitizeLessonsDone(a), ...sanitizeLessonsDone(b)]);

export const readLessonsDone = async (repo: Repo): Promise<LessonDone[]> => sanitizeLessonsDone(await repo.getMeta(LESSONS_KEY));

// taps can come quickly: read-modify-write is queued so that none is lost
let queue: Promise<unknown> = Promise.resolve();
export function setLessonDone(repo: Repo, id: string, done: boolean, now = Date.now()): Promise<LessonDone[]> {
  const run = queue.then(async () => {
    const list = (await readLessonsDone(repo)).filter((x) => x.id !== id);
    const next = done && known.has(id) ? sanitizeLessonsDone([...list, { id, ts: now }]) : list;
    await repo.setMeta(LESSONS_KEY, next);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
