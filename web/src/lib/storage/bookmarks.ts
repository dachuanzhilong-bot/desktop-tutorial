import type { Repo } from "./types";

/** a Study position the user wants to keep, with a note; `href` is the app path that opens it (lib/study/links.ts) */
export interface Bookmark {
  id: string;
  /** when it was first saved: the list is shown in this order, so a card does not jump when its note is edited */
  created: number;
  /** when it was last edited: decides which copy wins when two devices' lists are merged */
  ts: number;
  title: string;
  note: string;
  href: string;
}

/** kept in the meta store: part of the backup file, and the database schema stays as it is */
export const BOOKMARKS_KEY = "study.bookmarks";
export const BOOKMARKS_MAX = 300;
export const TITLE_MAX = 160;
export const NOTE_MAX = 2000;

const HREF = /^\/study\/(postflop\/)?#[\w=&.-]*$/;

function clean(x: unknown): Bookmark | null {
  if (!x || typeof x !== "object") return null;
  const b = x as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id || typeof b.ts !== "number" || !Number.isFinite(b.ts)) return null;
  if (typeof b.title !== "string" || typeof b.note !== "string" || typeof b.href !== "string" || !HREF.test(b.href)) return null;
  const created = typeof b.created === "number" && Number.isFinite(b.created) ? b.created : b.ts;
  return { id: b.id, created, ts: b.ts, title: b.title.slice(0, TITLE_MAX), note: b.note.slice(0, NOTE_MAX), href: b.href };
}

const newestFirst = (a: Bookmark, b: Bookmark) => b.created - a.created || b.ts - a.ts;

/** the valid bookmarks of a stored or imported value, newest first */
export function sanitizeBookmarks(v: unknown): Bookmark[] {
  if (!Array.isArray(v)) return [];
  return v.map(clean).filter((b): b is Bookmark => b !== null).sort(newestFirst);
}

/** union by id (the later edit wins, the earlier save time stays), newest first, at most BOOKMARKS_MAX */
export function mergeBookmarks(a: unknown, b: unknown): Bookmark[] {
  const byId = new Map<string, Bookmark>();
  for (const x of [...sanitizeBookmarks(a), ...sanitizeBookmarks(b)]) {
    const have = byId.get(x.id);
    if (!have) byId.set(x.id, x);
    else byId.set(x.id, { ...(x.ts > have.ts ? x : have), created: Math.min(x.created, have.created) });
  }
  return [...byId.values()].sort(newestFirst).slice(0, BOOKMARKS_MAX);
}

export const readBookmarks = async (repo: Repo): Promise<Bookmark[]> => sanitizeBookmarks(await repo.getMeta(BOOKMARKS_KEY));

// edits come from taps in quick succession: read-modify-write is queued so that none is lost
let queue: Promise<unknown> = Promise.resolve();
function change(repo: Repo, fn: (list: Bookmark[]) => Bookmark[]): Promise<Bookmark[]> {
  const run = queue.then(async () => {
    const next = fn(await readBookmarks(repo)).slice(0, BOOKMARKS_MAX);
    await repo.setMeta(BOOKMARKS_KEY, next);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

/** adds a bookmark, or replaces the one with the same id */
export const upsertBookmark = (repo: Repo, b: Bookmark): Promise<Bookmark[]> => {
  const c = clean(b);
  if (!c) return Promise.reject(new Error("invalid bookmark"));
  return change(repo, (list) => mergeBookmarks(list.filter((x) => x.id !== c.id), [c]));
};

export const removeBookmark = (repo: Repo, id: string): Promise<Bookmark[]> => change(repo, (list) => list.filter((x) => x.id !== id));
