import type { SrsItem } from "../practice/srs";
import { MemoryRepo } from "./memory";
import type { Attempt, ExportBlob, Repo } from "./types";

const DB_NAME = "tessera";
const DB_VERSION = 1;

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
    return { app: "tessera", version: 1, exportedAt: Date.now(), attempts: await this.allAttempts(), srs: await this.allSrs(), meta };
  }
  async importAll(b: ExportBlob) {
    if (b.app !== "tessera") throw new Error("not a Tessera export");
    const have = new Set((await this.allAttempts()).map((a) => `${a.ts}:${a.nodeId}:${a.hand}`));
    for (const a of b.attempts) if (!have.has(`${a.ts}:${a.nodeId}:${a.hand}`)) await this.addAttempt(a);
    const cur = new Map((await this.allSrs()).map((x) => [x.key, x]));
    for (const s of b.srs) if (!cur.has(s.key) || cur.get(s.key)!.updated < s.updated) await this.putSrs(s);
    for (const [k, v] of Object.entries(b.meta)) await this.setMeta(k, v);
  }
  async clear() {
    for (const n of ["attempts", "srs", "meta"]) await wrap((await this.store(n, "readwrite")).clear());
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
