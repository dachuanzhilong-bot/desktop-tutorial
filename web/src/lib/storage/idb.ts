import { mergeMeta } from "./metaMerge";
import type { SrsItem } from "../practice/srs";
import { MemoryRepo } from "./memory";
import type { Attempt, ExportBlob, Repo, SavedRange, SavedSolve, StoredHand } from "./types";

const DB_NAME = "tessera";
const DB_VERSION = 3;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("attempts")) {
        const s = db.createObjectStore("attempts", { keyPath: "id", autoIncrement: true });
        s.createIndex("ts", "ts");
      }
      if (!db.objectStoreNames.contains("srs")) db.createObjectStore("srs", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      // v2: custom solves + named ranges
      if (!db.objectStoreNames.contains("solves")) db.createObjectStore("solves", { keyPath: "id" });
      if (!db.objectStoreNames.contains("ranges")) db.createObjectStore("ranges", { keyPath: "id" });
      // v3: imported hand histories
      if (!db.objectStoreNames.contains("hands")) db.createObjectStore("hands", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const wrap = <T,>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/** IndexedDB-backed repository (local-first storage). */
export class IdbRepo implements Repo {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = open();
  }
  private async store(name: string, mode: IDBTransactionMode = "readonly") {
    const db = await this.db;
    return db.transaction(name, mode).objectStore(name);
  }
  async addAttempt(a: Attempt) {
    const { id: _ignore, ...rest } = a;
    await wrap((await this.store("attempts", "readwrite")).add(rest));
  }
  async allAttempts() {
    return wrap((await this.store("attempts")).getAll()) as Promise<Attempt[]>;
  }
  async allSrs() {
    return wrap((await this.store("srs")).getAll()) as Promise<SrsItem[]>;
  }
  async putSrs(item: SrsItem) {
    await wrap((await this.store("srs", "readwrite")).put(item));
  }
  async getMeta<T>(key: string) {
    return (await wrap((await this.store("meta")).get(key))) as T | undefined;
  }
  async setMeta<T>(key: string, value: T) {
    await wrap((await this.store("meta", "readwrite")).put(value, key));
  }
  async exportAll(): Promise<ExportBlob> {
    const meta: Record<string, unknown> = {};
    const s = await this.store("meta");
    const keys = (await wrap(s.getAllKeys())) as string[];
    for (const k of keys) meta[k] = await this.getMeta(k);
    return { app: "tessera", version: 1, exportedAt: Date.now(), attempts: await this.allAttempts(), srs: await this.allSrs(), meta, ranges: await this.listRanges(), hands: await this.listHands() };
  }
  async importAll(b: ExportBlob) {
    if (b.app !== "tessera") throw new Error("not a Tessera export");
    const have = new Set((await this.allAttempts()).map((a) => `${a.ts}:${a.nodeId}:${a.hand}`));
    for (const a of b.attempts) if (!have.has(`${a.ts}:${a.nodeId}:${a.hand}`)) await this.addAttempt(a);
    const cur = new Map((await this.allSrs()).map((x) => [x.key, x]));
    for (const s of b.srs) if (!cur.has(s.key) || cur.get(s.key)!.updated < s.updated) await this.putSrs(s);
    // lists that grow on every device (the ICM drill log, saved positions) are merged, the rest is replaced
    for (const [k, v] of Object.entries(b.meta)) await this.setMeta(k, mergeMeta(k, await this.getMeta(k), v));
    for (const r of b.ranges ?? []) await this.putRange(r);
    await this.putHands(b.hands ?? []);
  }
  async putSolve(s: SavedSolve) {
    await wrap((await this.store("solves", "readwrite")).put(s));
  }
  async listSolves() {
    const all = (await wrap((await this.store("solves")).getAll())) as SavedSolve[];
    return all.sort((a, b) => b.ts - a.ts);
  }
  async getSolve(id: string) {
    return (await wrap((await this.store("solves")).get(id))) as SavedSolve | undefined;
  }
  async deleteSolve(id: string) {
    await wrap((await this.store("solves", "readwrite")).delete(id));
  }
  async putRange(r: SavedRange) {
    await wrap((await this.store("ranges", "readwrite")).put(r));
  }
  async listRanges() {
    const all = (await wrap((await this.store("ranges")).getAll())) as SavedRange[];
    return all.sort((a, b) => b.ts - a.ts);
  }
  async deleteRange(id: string) {
    await wrap((await this.store("ranges", "readwrite")).delete(id));
  }
  async putHands(list: StoredHand[]) {
    if (!list.length) return;
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("hands", "readwrite");
      for (const h of list) tx.objectStore("hands").put(h);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async listHands() {
    const all = (await wrap((await this.store("hands")).getAll())) as StoredHand[];
    return all.sort((a, b) => b.ts - a.ts);
  }
  async deleteHand(id: string) {
    await wrap((await this.store("hands", "readwrite")).delete(id));
  }
  async clearHands() {
    await wrap((await this.store("hands", "readwrite")).clear());
  }
  async clear() {
    for (const n of ["attempts", "srs", "meta", "solves", "ranges", "hands"]) await wrap((await this.store(n, "readwrite")).clear());
  }
}

let repo: Repo | null = null;
/** singleton repository; falls back to memory when IndexedDB is unavailable (private mode, SSR) */
export function getRepo(): Repo {
  if (repo) return repo;
  try {
    if (typeof indexedDB === "undefined") throw new Error("no idb");
    repo = new IdbRepo();
  } catch {
    repo = new MemoryRepo();
  }
  return repo;
}
