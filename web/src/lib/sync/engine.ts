import type { Repo } from "../storage/types";
import { mergeSyncedBookmarks, readBookmarkDeletions, readBookmarks } from "../storage/bookmarks";
import type { Bookmark, BookmarkDeletion } from "../storage/bookmarks";
import { mergeIcmLogIntoRepo, readIcmLog } from "../storage/icmLog";
import { attemptKey, attemptToRow, bookmarkDeletionToRow, bookmarkToRow, emptyState, icmLogKey, icmLogToRow, rangeToRow, rowToAttempt, rowToBookmark, rowToBookmarkDeletion, rowToIcmLog, rowToRange, rowToSrs, srsToRow } from "./types";
import type { SyncBackend, SyncState } from "./types";

/** the app settings live in localStorage (not in the repository): the engine reaches them through this */
export interface SettingsIo {
  /** `updated` = when the user last changed a setting on this device (0 = never) */
  get(): { data: Record<string, unknown>; updated: number };
  apply(data: Record<string, unknown>, updated: number): void;
}

export interface SyncReport {
  pushedAttempts: number;
  pulledAttempts: number;
  pushedSrs: number;
  pulledSrs: number;
  pushedRanges: number;
  pulledRanges: number;
  pushedIcmLog: number;
  pulledIcmLog: number;
  pushedBookmarks: number;
  pulledBookmarks: number;
  settings: "none" | "pushed" | "pulled";
}

const stateKey = (user: string) => `sync.state.${user}`;

export async function loadState(repo: Repo, user: string): Promise<SyncState> {
  const s = await repo.getMeta<Partial<SyncState>>(stateKey(user));
  const clientId = typeof s?.clientId === "string" && s.clientId ? s.clientId : typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const defaults = emptyState(clientId);
  const bookmarkTs = s?.bookmarkTs && typeof s.bookmarkTs === "object" && !Array.isArray(s.bookmarkTs) ? s.bookmarkTs : {};
  return {
    ...defaults,
    ...s,
    clientId,
    pushedIcmKeys: Array.isArray(s?.pushedIcmKeys) ? s.pushedIcmKeys.filter((k): k is string => typeof k === "string") : [],
    pullIcmTs: Number.isFinite(s?.pullIcmTs) ? s!.pullIcmTs! : 0,
    bookmarkTs: Object.fromEntries(Object.entries(bookmarkTs).filter(([, ts]) => typeof ts === "number" && Number.isFinite(ts))) as Record<string, number>,
    pullBookmarkTs: Number.isFinite(s?.pullBookmarkTs) ? s!.pullBookmarkTs! : 0,
  };
}

/**
 * One local-first sync round. Safe to repeat and to run from several devices:
 *  - attempts are append-only; duplicates are recognised by (ts, position key, hand) and rows pulled from the server are marked
 *    `remote` so they are never uploaded again;
 *  - spaced-repetition items, ranges and bookmarks: the newer `updated` / `ts` wins per item (last writer wins);
 *  - ICM answers are append-only; bookmarks carry deletion tombstones so old copies cannot bring them back;
 *  - settings: the newer side wins as a whole.
 * Saved Study position deletions are synchronised with tombstones; saved-range deletions are not.
 */
export async function syncOnce(repo: Repo, backend: SyncBackend, user: string, io: SettingsIo): Promise<SyncReport> {
  const state = await loadState(repo, user);
  const report: SyncReport = { pushedAttempts: 0, pulledAttempts: 0, pushedSrs: 0, pulledSrs: 0, pushedRanges: 0, pulledRanges: 0, pushedIcmLog: 0, pulledIcmLog: 0, pushedBookmarks: 0, pulledBookmarks: 0, settings: "none" };
  const iso = (ms: number) => new Date(ms).toISOString();

  // ---- attempts: push
  const local = await repo.allAttempts();
  const fresh = local.filter((a) => !a.remote && (a.id ?? 0) > state.pushedAttemptId);
  if (fresh.length) {
    await backend.pushAttempts(fresh.map((a) => attemptToRow(a, state.clientId)));
    state.pushedAttemptId = Math.max(state.pushedAttemptId, ...fresh.map((a) => a.id ?? 0));
    report.pushedAttempts = fresh.length;
  }
  // ---- attempts: pull
  const rows = await backend.pullAttempts(iso(state.pullAttemptTs));
  if (rows.length) {
    const have = new Set(local.map(attemptKey));
    for (const r of rows) {
      // a row another device made before position keys cannot be read: it stays on the server and is not taken
      const a = rowToAttempt(r);
      if (!a) continue;
      const k = attemptKey(a);
      if (have.has(k)) continue;
      have.add(k);
      await repo.addAttempt(a);
      report.pulledAttempts++;
    }
    state.pullAttemptTs = Math.max(state.pullAttemptTs, ...rows.map((r) => Date.parse(r.ts)));
  }

  // ---- spaced repetition: last writer wins per item
  const srs = await repo.allSrs();
  const srsFresh = srs.filter((s) => s.updated > state.pushedSrs);
  if (srsFresh.length) {
    await backend.pushSrs(srsFresh.map(srsToRow));
    state.pushedSrs = Math.max(state.pushedSrs, ...srsFresh.map((s) => s.updated));
    report.pushedSrs = srsFresh.length;
  }
  const srsRows = await backend.pullSrs(iso(state.pullSrs));
  if (srsRows.length) {
    const byKey = new Map(srs.map((s) => [s.key, s]));
    for (const r of srsRows) {
      const mine = byKey.get(r.key);
      const theirs = rowToSrs(r);
      if (theirs && (!mine || mine.updated < theirs.updated)) {
        await repo.putSrs(theirs);
        report.pulledSrs++;
      }
    }
    state.pullSrs = Math.max(state.pullSrs, ...srsRows.map((r) => Date.parse(r.updated)));
    // what we just wrote came from the server: do not upload it again
    state.pushedSrs = Math.max(state.pushedSrs, state.pullSrs);
  }

  // ---- ranges
  const ranges = await repo.listRanges();
  const rFresh = ranges.filter((r) => r.ts > state.pushedRanges);
  if (rFresh.length) {
    await backend.pushRanges(rFresh.map(rangeToRow));
    state.pushedRanges = Math.max(state.pushedRanges, ...rFresh.map((r) => r.ts));
    report.pushedRanges = rFresh.length;
  }
  const rRows = await backend.pullRanges(iso(state.pullRanges));
  if (rRows.length) {
    const byId = new Map(ranges.map((r) => [r.id, r]));
    for (const row of rRows) {
      const mine = byId.get(row.id);
      const theirs = rowToRange(row);
      if (!mine || mine.ts < theirs.ts) {
        await repo.putRange(theirs);
        report.pulledRanges++;
      }
    }
    state.pullRanges = Math.max(state.pullRanges, ...rRows.map((r) => Date.parse(r.ts)));
    state.pushedRanges = Math.max(state.pushedRanges, state.pullRanges);
  }

  // ---- ICM practice: append-only, deduplicated with the same key as the local log
  const icm = await readIcmLog(repo);
  const knownIcm = new Set(state.pushedIcmKeys);
  const icmFresh = icm.filter((entry) => !knownIcm.has(icmLogKey(entry)));
  if (icmFresh.length) {
    await backend.pushIcmLog(icmFresh.map(icmLogToRow));
    for (const entry of icmFresh) knownIcm.add(icmLogKey(entry));
    report.pushedIcmLog = icmFresh.length;
  }
  const icmRows = await backend.pullIcmLog(iso(state.pullIcmTs));
  const icmIncoming = icmRows.map(rowToIcmLog).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (icmRows.length) {
    const before = new Set((await readIcmLog(repo)).map(icmLogKey));
    const merged = await mergeIcmLogIntoRepo(repo, icmIncoming);
    report.pulledIcmLog = merged.filter((entry) => !before.has(icmLogKey(entry))).length;
    state.pullIcmTs = Math.max(state.pullIcmTs, ...icmRows.map((r) => Date.parse(r.ts)).filter(Number.isFinite));
    for (const entry of icmIncoming) knownIcm.add(icmLogKey(entry));
  }
  // Keep only keys still in the bounded local log. Pulled keys are known too, so they are not echoed.
  state.pushedIcmKeys = (await readIcmLog(repo)).filter((entry) => knownIcm.has(icmLogKey(entry))).map(icmLogKey);

  // ---- saved Study positions: pull first, then resolve each id by version (delete wins a tie)
  // There are usually few saved positions. Fetch all on each sync so a late write or a device clock
  // behind the previous cursor cannot leave a bookmark or tombstone permanently unseen.
  const bookmarkRows = await backend.pullBookmarks(iso(0));
  if (bookmarkRows.length) {
    const beforeActive = await readBookmarks(repo);
    const beforeDeleted = await readBookmarkDeletions(repo);
    const active = bookmarkRows.map(rowToBookmark).filter((b): b is NonNullable<typeof b> => b !== null);
    const deleted = bookmarkRows.map(rowToBookmarkDeletion).filter((d): d is NonNullable<typeof d> => d !== null);
    const merged = await mergeSyncedBookmarks(repo, active, deleted);
    report.pulledBookmarks = changedBookmarkCount(beforeActive, beforeDeleted, merged.bookmarks, merged.deletions);
    for (const row of bookmarkRows) {
      const ts = Date.parse(row.ts);
      if (!row.id || !Number.isFinite(ts)) continue;
      state.bookmarkTs[row.id] = Math.max(state.bookmarkTs[row.id] ?? 0, ts);
    }
    state.pullBookmarkTs = Math.max(state.pullBookmarkTs, ...bookmarkRows.map((r) => Date.parse(r.ts)).filter(Number.isFinite));
  }
  const localBookmarks = await readBookmarks(repo);
  const localBookmarkDeletions = await readBookmarkDeletions(repo);
  const bookmarkUploads = [
    ...localBookmarks.filter((b) => b.ts > (state.bookmarkTs[b.id] ?? 0)).map(bookmarkToRow),
    ...localBookmarkDeletions.filter((d) => d.ts > (state.bookmarkTs[d.id] ?? 0)).map(bookmarkDeletionToRow),
  ];
  if (bookmarkUploads.length) {
    await backend.pushBookmarks(bookmarkUploads);
    for (const row of bookmarkUploads) state.bookmarkTs[row.id] = Math.max(state.bookmarkTs[row.id] ?? 0, Date.parse(row.ts));
    report.pushedBookmarks = bookmarkUploads.length;
  }

  // ---- settings
  const mine = io.get();
  const theirs = await backend.pullSettings();
  const theirsAt = theirs ? Date.parse(theirs.updated) : 0;
  if (theirs && theirsAt > mine.updated) {
    io.apply(theirs.data, theirsAt);
    report.settings = "pulled";
  } else if (mine.updated > theirsAt) {
    await backend.pushSettings({ data: mine.data, updated: iso(mine.updated) });
    report.settings = "pushed";
  }

  state.lastSync = Date.now();
  await repo.setMeta(stateKey(user), state);
  return report;
}

function changedBookmarkCount(before: Bookmark[], beforeDeleted: BookmarkDeletion[], after: Bookmark[], afterDeleted: BookmarkDeletion[]) {
  const versions = (active: Bookmark[], deleted: BookmarkDeletion[]) => {
    const map = new Map<string, string>();
    for (const b of active) map.set(b.id, `a:${b.ts}:${b.title}:${b.note}:${b.href}`);
    for (const d of deleted) map.set(d.id, `d:${d.ts}`);
    return map;
  };
  const a = versions(before, beforeDeleted);
  const b = versions(after, afterDeleted);
  return [...b].filter(([id, value]) => a.get(id) !== value).length;
}
