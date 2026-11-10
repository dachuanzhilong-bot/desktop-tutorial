import type { Grade } from "../practice/grading";
import type { SrsItem } from "../practice/srs";
import type { Attempt, SavedRange } from "../storage/types";

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
}

export interface SrsRow {
  key: string;
  node_id: number;
  hand: number;
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
  lastSync: number;
}

export const emptyState = (clientId: string): SyncState => ({ clientId, pushedAttemptId: 0, pullAttemptTs: 0, pushedSrs: 0, pullSrs: 0, pushedRanges: 0, pullRanges: 0, lastSync: 0 });

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
  };
}

export function rowToAttempt(r: AttemptRow): Attempt {
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
  };
}

export const attemptKey = (a: { ts: number; nodeId: number; hand: number }) => `${a.ts}:${a.nodeId}:${a.hand}`;

export const srsToRow = (s: SrsItem): SrsRow => ({ key: s.key, node_id: s.nodeId, hand: s.hand, box: s.box, due: iso(s.due), seen: s.seen, lapses: s.lapses, last_grade: s.lastGrade, updated: iso(s.updated) });
export const rowToSrs = (r: SrsRow): SrsItem => ({ key: r.key, nodeId: r.node_id, hand: r.hand, box: r.box, due: Date.parse(r.due), seen: r.seen, lapses: r.lapses, lastGrade: r.last_grade, updated: Date.parse(r.updated) });

export const rangeToRow = (r: SavedRange): RangeRow => ({ id: r.id, name: r.name, range_text: r.text, ts: iso(r.ts) });
export const rowToRange = (r: RangeRow): SavedRange => ({ id: r.id, name: r.name, text: r.range_text, ts: Date.parse(r.ts) });
