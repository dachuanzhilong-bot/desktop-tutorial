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

/** a deletion version kept so other devices and older backups cannot restore the position; included in backups */
export interface BookmarkDeletion {
  id: string;
  ts: number;
}

/** kept in the meta store: part of the backup file, and the database schema stays as it is */
export const BOOKMARKS_KEY = "study.bookmarks";
export const BOOKMARK_DELETIONS_KEY = "study.bookmarkDeletions";
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

export function sanitizeBookmarkDeletions(v: unknown): BookmarkDeletion[] {
  if (!Array.isArray(v)) return [];
  const byId = new Map<string, BookmarkDeletion>();
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const d = x as Record<string, unknown>;
    if (typeof d.id !== "string" || !d.id || typeof d.ts !== "number" || !Number.isFinite(d.ts)) continue;
    const have = byId.get(d.id);
    if (!have || d.ts > have.ts) byId.set(d.id, { id: d.id, ts: d.ts });
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

export function mergeBookmarkDeletions(a: unknown, b: unknown): BookmarkDeletion[] {
  return sanitizeBookmarkDeletions([...sanitizeBookmarkDeletions(a), ...sanitizeBookmarkDeletions(b)]);
}

function reconcile(activeInput: unknown, deletionInput: unknown) {
  const active = mergeBookmarks([], activeInput);
  const deletions = mergeBookmarkDeletions([], deletionInput);
  const activeById = new Map(active.map((b) => [b.id, b]));
  const deletedById = new Map(deletions.map((d) => [d.id, d]));
  return {
    bookmarks: active.filter((b) => (deletedById.get(b.id)?.ts ?? -1) < b.ts),
    deletions: deletions.filter((d) => (activeById.get(d.id)?.ts ?? -1) <= d.ts),
  };
}

async function storedState(repo: Repo) {
  const [active, deleted] = await Promise.all([
    repo.getMeta(BOOKMARKS_KEY),
    repo.getMeta(BOOKMARK_DELETIONS_KEY),
  ]);
  return reconcile(active, deleted);
}

export const readBookmarks = async (repo: Repo): Promise<Bookmark[]> => (await storedState(repo)).bookmarks;
export const readBookmarkDeletions = async (repo: Repo): Promise<BookmarkDeletion[]> => (await storedState(repo)).deletions;

/** Merge cloud bookmark versions, resolving an equal-time conflict in favour of a deletion. */
export async function mergeSyncedBookmarks(repo: Repo, active: unknown, deleted: unknown) {
  return enqueue(async () => {
    const local = await storedState(repo);
    const next = reconcile(mergeBookmarks(local.bookmarks, active), mergeBookmarkDeletions(local.deletions, deleted));
    // Save tombstones first so a crash cannot make an already deleted position visible again.
    await repo.setMeta(BOOKMARK_DELETIONS_KEY, next.deletions);
    await repo.setMeta(BOOKMARKS_KEY, next.bookmarks);
    return next;
  });
}

// edits and sync merges are queued so read-modify-write never interleaves
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

/** adds a bookmark, or replaces the one with the same id */
export const upsertBookmark = (repo: Repo, b: Bookmark): Promise<Bookmark[]> => {
  const c = clean(b);
  if (!c) return Promise.reject(new Error("invalid bookmark"));
  return enqueue(async () => {
    const current = await storedState(repo);
    const existing = current.bookmarks.find((x) => x.id === c.id);
    const deletion = current.deletions.find((x) => x.id === c.id);
    const nextTs = Math.max(c.ts, (existing?.ts ?? -1) + 1, (deletion?.ts ?? -1) + 1);
    const next = mergeBookmarks(current.bookmarks.filter((x) => x.id !== c.id), [{ ...c, ts: nextTs }]);
    await repo.setMeta(BOOKMARKS_KEY, next);
    await repo.setMeta(BOOKMARK_DELETIONS_KEY, current.deletions.filter((x) => x.id !== c.id));
    return next;
  });
};

export const removeBookmark = (repo: Repo, id: string): Promise<Bookmark[]> =>
  enqueue(async () => {
    const current = await storedState(repo);
    const have = current.bookmarks.find((x) => x.id === id);
    if (!have) return current.bookmarks;
    const ts = Math.max(Date.now(), have.ts + 1, (current.deletions.find((x) => x.id === id)?.ts ?? -1) + 1);
    const next = current.bookmarks.filter((x) => x.id !== id);
    const deleted = mergeBookmarkDeletions(current.deletions, [{ id, ts }]);
    await repo.setMeta(BOOKMARK_DELETIONS_KEY, deleted);
    await repo.setMeta(BOOKMARKS_KEY, next);
    return next;
  });
