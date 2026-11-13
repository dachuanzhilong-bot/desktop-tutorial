import type { Grade } from "../practice/grading";
import type { SrsItem } from "../practice/srs";
import type { Attempt, SavedRange } from "../storage/types";
import { attemptKey } from "../storage/obsolete";
import { sanitizeBookmarks } from "../storage/bookmarks";
import type { Bookmark, BookmarkDeletion } from "../storage/bookmarks";
import { sanitizeIcmLog } from "../storage/icmLog";
import type { IcmLogEntry } from "../storage/icmLog";

/** rows exactly as in supabase/schema.sql (snake_case, timestamps as ISO strings) */
export interface AttemptRow {
  client_id: string;
  ts: string;
  session_id: string;
  mode: Attempt["mode"];
  solution: string;
  node_id: number;
  hand: number;
  seat: number;
  spot: string;
  chosen: number;
  best: number;
  grade: Grade;
  ev_loss: number;
  score: number;
  ms: number | null;
  flags: number;
  /** position key and build ID. A row without `pos` (null, or absent in an older server copy) was made before position keys: it is not pulled. */
  pos?: string | null;
  build?: string | null;
}

export interface SrsRow {
  key: string;
  node_id: number;
  hand: number;
  /** solution, position key and build ID. A row without `solution` / `pos` was made before position keys: it is not pulled. */
  solution?: string | null;
  pos?: string | null;
  build?: string | null;
  box: number;
  due: string;
  seen: number;
  lapses: number;
  last_grade: Grade;
  updated: string;
}

export interface RangeRow {
  id: string;
  name: string;
  range_text: string;
  ts: string;
}

export interface SettingsRow {
  data: Record<string, unknown>;
  updated: string;
}

export interface IcmLogRow {
  ts: string;
  players: number;
  pos: string;
  stack: number;
  facing: string | null;
  hand: number;
  chosen: 0 | 1;
  grade: Grade;
  ev_loss: number;
  score: number;
}

/** A deleted bookmark is a tombstone with its id and version; the other fields are null. */
export interface BookmarkRow {
  id: string;
  created: string | null;
  ts: string;
  deleted: boolean;
  title: string | null;
  note: string | null;
  href: string | null;
}

/** What the sync engine needs from a server. `SupabaseBackend` implements it; tests use an in-memory fake. */
export interface SyncBackend {
  pushAttempts(rows: AttemptRow[]): Promise<void>;
  /** rows with ts >= sinceIso, oldest first */
  pullAttempts(sinceIso: string): Promise<AttemptRow[]>;
  pushSrs(rows: SrsRow[]): Promise<void>;
  /** rows with updated >= sinceIso */
  pullSrs(sinceIso: string): Promise<SrsRow[]>;
  pushRanges(rows: RangeRow[]): Promise<void>;
  pullRanges(sinceIso: string): Promise<RangeRow[]>;
  pushIcmLog(rows: IcmLogRow[]): Promise<void>;
  /** rows with ts >= sinceIso, oldest first */
  pullIcmLog(sinceIso: string): Promise<IcmLogRow[]>;
  pushBookmarks(rows: BookmarkRow[]): Promise<void>;
  /** rows with ts >= sinceIso, oldest first */
  pullBookmarks(sinceIso: string): Promise<BookmarkRow[]>;
  pushSettings(row: SettingsRow): Promise<void>;
  pullSettings(): Promise<SettingsRow | null>;
}

export interface SyncState {
  clientId: string;
  /** highest local attempt id that has been uploaded */
  pushedAttemptId: number;
  pullAttemptTs: number;
  pushedSrs: number;
  pullSrs: number;
  pushedRanges: number;
  pullRanges: number;
  /** keys of local ICM answers already present on the server (local log is capped at 2,000) */
  pushedIcmKeys: string[];
  pullIcmTs: number;
  /** highest server version seen for each saved-position id */
  bookmarkTs: Record<string, number>;
  pullBookmarkTs: number;
  lastSync: number;
}

export const emptyState = (clientId: string): SyncState => ({ clientId, pushedAttemptId: 0, pullAttemptTs: 0, pushedSrs: 0, pullSrs: 0, pushedRanges: 0, pullRanges: 0, pushedIcmKeys: [], pullIcmTs: 0, bookmarkTs: {}, pullBookmarkTs: 0, lastSync: 0 });

// ---------------------------------------------------------------- mapping

const iso = (ms: number) => new Date(ms).toISOString();

export function attemptToRow(a: Attempt, clientId: string): AttemptRow {
  return {
    client_id: clientId,
    ts: iso(a.ts),
    session_id: a.sessionId,
    mode: a.mode,
    solution: a.solution,
    node_id: a.nodeId,
    hand: a.hand,
    seat: a.seat,
    spot: a.spot,
    chosen: a.chosen,
    best: a.best,
    grade: a.grade,
    ev_loss: a.evLoss,
    score: a.score,
    ms: Number.isFinite(a.ms) ? Math.round(a.ms) : null,
    flags: (a.rng ? 1 : 0) | (a.timeout ? 2 : 0) | (a.hint ? 4 : 0),
    // always present (null when unknown): every row of one upload must have the same columns
    pos: a.pos,
    build: a.build ?? null,
  };
}

/** the record of a row; null for a row made before position keys (no `pos`), which cannot be read any more */
export function rowToAttempt(r: AttemptRow): Attempt | null {
  if (typeof r.pos !== "string" || !r.pos) return null;
  return {
    ts: Date.parse(r.ts),
    sessionId: r.session_id,
    mode: r.mode,
    solution: r.solution,
    nodeId: r.node_id,
    hand: r.hand,
    seat: r.seat,
    spot: r.spot as Attempt["spot"],
    chosen: r.chosen,
    best: r.best,
    grade: r.grade,
    evLoss: r.ev_loss,
    score: r.score,
    ms: r.ms ?? 0,
    rng: (r.flags & 1) !== 0,
    timeout: (r.flags & 2) !== 0,
    hint: (r.flags & 4) !== 0,
    remote: true,
    pos: r.pos,
    ...(typeof r.build === "string" ? { build: r.build } : {}),
  };
}

export { attemptKey };

export const srsToRow = (s: SrsItem): SrsRow => ({
  key: s.key,
  node_id: s.nodeId,
  hand: s.hand,
  box: s.box,
  due: iso(s.due),
  seen: s.seen,
  lapses: s.lapses,
  last_grade: s.lastGrade,
  updated: iso(s.updated),
  // always present (null when unknown): every row of one upload must have the same columns
  solution: s.solution,
  pos: s.pos,
  build: s.build ?? null,
});
/** the item of a row; null for a row made before position keys (no `solution` / `pos`) */
export const rowToSrs = (r: SrsRow): SrsItem | null =>
  typeof r.solution !== "string" || !r.solution || typeof r.pos !== "string" || !r.pos ? null : {
  key: r.key,
  nodeId: r.node_id,
  hand: r.hand,
  box: r.box,
  due: Date.parse(r.due),
  seen: r.seen,
  lapses: r.lapses,
  lastGrade: r.last_grade,
  updated: Date.parse(r.updated),
  solution: r.solution,
  pos: r.pos,
  ...(typeof r.build === "string" ? { build: r.build } : {}),
};

export const rangeToRow = (r: SavedRange): RangeRow => ({ id: r.id, name: r.name, range_text: r.text, ts: iso(r.ts) });
export const rowToRange = (r: RangeRow): SavedRange => ({ id: r.id, name: r.name, text: r.range_text, ts: Date.parse(r.ts) });

export const icmLogKey = (e: Pick<IcmLogEntry, "ts" | "hand" | "chosen">) => `${e.ts}:${e.hand}:${e.chosen}`;
export const icmLogToRow = (e: IcmLogEntry): IcmLogRow => ({ ts: iso(e.ts), players: e.players, pos: e.pos, stack: e.stack, facing: e.facing, hand: e.hand, chosen: e.chosen, grade: e.grade, ev_loss: e.evLoss, score: e.score });
export function rowToIcmLog(r: IcmLogRow): IcmLogEntry | null {
  return sanitizeIcmLog([{ ts: Date.parse(r.ts), players: r.players, pos: r.pos, stack: r.stack, facing: r.facing, hand: r.hand, chosen: r.chosen, grade: r.grade, evLoss: r.ev_loss, score: r.score }])[0] ?? null;
}

export const bookmarkToRow = (b: Bookmark): BookmarkRow => ({ id: b.id, created: iso(b.created), ts: iso(b.ts), deleted: false, title: b.title, note: b.note, href: b.href });
export const bookmarkDeletionToRow = (d: BookmarkDeletion): BookmarkRow => ({ id: d.id, created: null, ts: iso(d.ts), deleted: true, title: null, note: null, href: null });
export function rowToBookmark(r: BookmarkRow): Bookmark | null {
  if (r.deleted || !r.created || r.title === null || r.note === null || r.href === null) return null;
  return sanitizeBookmarks([{ id: r.id, created: Date.parse(r.created), ts: Date.parse(r.ts), title: r.title, note: r.note, href: r.href }])[0] ?? null;
}
export function rowToBookmarkDeletion(r: BookmarkRow): BookmarkDeletion | null {
  const ts = Date.parse(r.ts);
  return r.deleted && typeof r.id === "string" && !!r.id && Number.isFinite(ts) ? { id: r.id, ts } : null;
}
