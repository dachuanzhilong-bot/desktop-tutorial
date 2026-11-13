/**
 * Records in the format used before position keys (REFACTOR_PLAN step 1-4, docs/03 "記録が持つ局面").
 *
 * Such a record names its decision by numbers that change when the solution data is generated again, so it cannot
 * be read any more. It is not converted: the database upgrade to version 4 deletes it (lib/storage/idb.ts), a backup
 * file's old records are left out when the file is read, and so are old rows another device left on the server.
 * Everything here takes `unknown`: the values come from a database, a file or a server, not from this code.
 */
import { BOOKMARK_DELETIONS_KEY, BOOKMARKS_KEY } from "./bookmarks";
import type { Attempt, ExportBlob, StoredHand } from "./types";
import type { SrsItem } from "../practice/srs";

const text = (v: unknown): v is string => typeof v === "string" && v !== "";
const fields = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null);

/** a practice record that says where it belongs by a position key */
export function isCurrentAttempt(v: unknown): v is Attempt {
  return text(fields(v)?.pos);
}

/** a spaced-repetition item that says where it belongs by a solution and a position key */
export function isCurrentSrs(v: unknown): v is SrsItem {
  const r = fields(v);
  return !!r && text(r.pos) && text(r.solution);
}

/**
 * An imported hand whose analysis names its solution and every graded decision by a position key. (A hand without
 * graded decisions points at no position; it is kept when it names its solution.)
 */
export function isCurrentHand(v: unknown): v is StoredHand {
  const a = fields(fields(v)?.analysis);
  if (!a || !text(a.solution) || !Array.isArray(a.decisions)) return false;
  if (!a.decisions.every((d) => text(fields(d)?.pos))) return false;
  return a.worst === null || a.worst === undefined || text(fields(a.worst)?.pos);
}

/**
 * Keys of the `meta` store that the upgrade to version 4 deletes:
 *  - saved Study positions and their deletion tombstones: their addresses held node numbers;
 *  - the sync state of every account: its cursors describe rows that are gone, so the next sync starts over;
 *  - prepared question lists (a review round, the mistakes Analyze found): node numbers, and made again on demand.
 * Everything else stays: the ICM drill log (`icm.log`) and the lessons done (`learn.done`) hold no position.
 */
export function isObsoleteMetaKey(key: unknown): boolean {
  if (typeof key !== "string") return false;
  return key === BOOKMARKS_KEY || key === BOOKMARK_DELETIONS_KEY || key.startsWith("sync.state.") || key.startsWith("practiceSet:");
}

/** what was left out of a backup file because it is in the old format */
export interface ImportReport {
  /** practice records, spaced-repetition items and imported hands without a position key */
  dropped: number;
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * The part of a backup file that can still be read: old records are left out (and counted), sync states and
 * prepared question lists are not taken over. Saved positions pass through here; the ones with an old address are
 * dropped where bookmarks are read (lib/storage/bookmarks.ts).
 */
export function currentPart(b: ExportBlob): { blob: ExportBlob; report: ImportReport } {
  const attempts = list(b.attempts).filter(isCurrentAttempt);
  const srs = list(b.srs).filter(isCurrentSrs);
  const hands = list(b.hands).filter(isCurrentHand);
  const dropped = list(b.attempts).length - attempts.length + (list(b.srs).length - srs.length) + (list(b.hands).length - hands.length);
  const meta = Object.fromEntries(Object.entries(fields(b.meta) ?? {}).filter(([k]) => !k.startsWith("sync.state.") && !k.startsWith("practiceSet:")));
  return { blob: { ...b, attempts, srs, meta, hands }, report: { dropped } };
}

/** two copies of one practice record (a backup read twice, a row that comes back from the server) have the same key */
export const attemptKey = (a: { ts: number; pos: string; hand: number }) => `${a.ts}:${a.pos}:${a.hand}`;
