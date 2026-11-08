import type { SrsItem } from "../practice/srs";
import type { Attempt, ExportBlob, Repo } from "./types";

export class MemoryRepo implements Repo {
  private attempts: Attempt[] = [];
  private srs = new Map<string, SrsItem>();
  private meta = new Map<string, unknown>();
  private seq = 1;

  async addAttempt(a: Attempt) {
    this.attempts.push({ ...a, id: this.seq++ });
  }
  async allAttempts() {
    return this.attempts.slice();
  }
  async allSrs() {
    return [...this.srs.values()];
  }
  async putSrs(item: SrsItem) {
    this.srs.set(item.key, item);
  }
  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined;
  }
  async setMeta<T>(key: string, value: T) {
    this.meta.set(key, value);
  }
  async exportAll(): Promise<ExportBlob> {
    return { app: "tessera", version: 1, exportedAt: Date.now(), attempts: await this.allAttempts(), srs: await this.allSrs(), meta: Object.fromEntries(this.meta) };
  }
  async importAll(b: ExportBlob) {
    for (const a of b.attempts) await this.addAttempt({ ...a, id: undefined });
    for (const s of b.srs) {
      const cur = this.srs.get(s.key);
      if (!cur || cur.updated < s.updated) this.srs.set(s.key, s);
    }
    for (const [k, v] of Object.entries(b.meta)) this.meta.set(k, v);
  }
  async clear() {
    this.attempts = [];
    this.srs.clear();
    this.meta.clear();
  }
}
