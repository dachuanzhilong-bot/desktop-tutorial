import type { Repo } from "../storage/types";
import { attemptKey, attemptToRow, emptyState, rangeToRow, rowToAttempt, rowToRange, rowToSrs, srsToRow } from "./types";
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
  settings: "none" | "pushed" | "pulled";
}

const stateKey = (user: string) => `sync.state.${user}`;

export async function loadState(repo: Repo, user: string): Promise<SyncState> {
  const s = await repo.getMeta<SyncState>(stateKey(user));
  if (s) return s;
  return emptyState(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
}

/**
 * One local-first sync round. Safe to repeat and to run from several devices:
 *  - attempts are append-only; duplicates are recognised by (ts, node, hand) and rows pulled from the server are marked
 *    `remote` so they are never uploaded again;
 *  - spaced-repetition items and ranges: the newer `updated` / `ts` wins per item (last writer wins);
 *  - settings: the newer side wins as a whole.
 * Deletions are not synchronised (documented limitation).
 */
export async function syncOnce(repo: Repo, backend: SyncBackend, user: string, io: SettingsIo): Promise<SyncReport> {
  const state = await loadState(repo, user);
  const report: SyncReport = { pushedAttempts: 0, pulledAttempts: 0, pushedSrs: 0, pulledSrs: 0, pushedRanges: 0, pulledRanges: 0, settings: "none" };
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
      const a = rowToAttempt(r);
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
      if (!mine || mine.updated < theirs.updated) {
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
