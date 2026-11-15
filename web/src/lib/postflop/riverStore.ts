/**
 * Solved rivers kept between visits (REFACTOR_PLAN 3-3-6): an IndexedDB database of its own, `tessera-river`, so the
 * user's records (`tessera`, lib/storage/idb.ts) and their backup / sync never see it. Everything in it can be thrown
 * away: a river that is not found is solved again.
 *
 *   store `rivers`, key path `key` (lib/postflop/river.ts riverCacheKey), index `ts`
 *   record { key, v: RIVER_RECORD_VERSION, bytes: Uint8Array (a TSP1 file), ts: last use (ms) }
 *
 * Limits: at most RIVER_STORE_LIMIT records; the least recently used go first. A record of another version or shape
 * is not read (and is the first to go).
 */
import type { RiverStore } from "./river";

const DB_NAME = "tessera-river";
const DB_VERSION = 1;
const STORE = "rivers";
/** the version of a record's shape; a record without it (or of another one) is ignored */
export const RIVER_RECORD_VERSION = 1;
/** records kept (one river is ~10-60 KB: a few MB at most) */
export const RIVER_STORE_LIMIT = 120;

export interface RiverRecord {
  key: string;
  v: number;
  bytes: Uint8Array;
  ts: number;
}

/** the `TSP1` file of a stored record, or undefined when the record is of another version or shape */
export function readRiverRecord(value: unknown, key: string): Uint8Array | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Partial<RiverRecord>;
  if (r.v !== RIVER_RECORD_VERSION || r.key !== key || !(r.bytes instanceof Uint8Array) || r.bytes.length < 5) return undefined;
  const b = r.bytes;
  return b[0] === 0x54 && b[1] === 0x53 && b[2] === 0x50 && b[3] === 0x31 ? b : undefined;
}

/** the keys to delete so that `limit` records stay: the oldest by last use; records that cannot be read go first */
export function keysToEvict(records: { key: string; ts: unknown; ok: boolean }[], limit: number): string[] {
  const order = records.slice().sort((a, b) => Number(a.ok) - Number(b.ok) || (Number(a.ts) || 0) - (Number(b.ts) || 0));
  const bad = order.filter((r) => !r.ok).map((r) => r.key);
  const good = order.filter((r) => r.ok);
  return [...bad, ...good.slice(0, Math.max(0, good.length - limit)).map((r) => r.key)];
}

const wrap = <T,>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" }).createIndex("ts", "ts");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** the IndexedDB store; null where there is no IndexedDB (the layer then keeps rivers in memory only) */
export function idbRiverStore(limit = RIVER_STORE_LIMIT): RiverStore | null {
  if (typeof indexedDB === "undefined") return null;
  let db: Promise<IDBDatabase> | null = null;
  const tx = async (mode: IDBTransactionMode) => (await (db ??= open())).transaction(STORE, mode).objectStore(STORE);
  return {
    async get(key) {
      const store = await tx("readwrite");
      const bytes = readRiverRecord(await wrap(store.get(key)), key);
      // last use, for the eviction order
      if (bytes) store.put({ key, v: RIVER_RECORD_VERSION, bytes, ts: Date.now() } satisfies RiverRecord);
      return bytes;
    },
    async put(key, bytes) {
      const store = await tx("readwrite");
      await wrap(store.put({ key, v: RIVER_RECORD_VERSION, bytes, ts: Date.now() } satisfies RiverRecord));
      const all = (await wrap(store.getAll())) as unknown[];
      const records = all.map((v) => {
        const r = (v ?? {}) as Partial<RiverRecord>;
        return { key: String(r.key), ts: r.ts, ok: readRiverRecord(v, String(r.key)) !== undefined };
      });
      for (const k of keysToEvict(records, limit)) store.delete(k);
    },
  };
}
