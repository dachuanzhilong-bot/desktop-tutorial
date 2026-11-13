import { mergeMeta } from "./metaMerge";
import { currentPart } from "./obsolete";
import type { SrsItem } from "../practice/srs";
import { isDerivedMetaKey } from "./statsCache";
import type { Attempt, ExportBlob, Repo, SavedRange, SavedSolve, StoredHand } from "./types";

/** the first index of a sorted list where `after` holds (it holds from there on); the length when it never does */
function firstIndex<T>(list: T[], after: (x: T) => boolean): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (after(list[mid])) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export class MemoryRepo implements Repo {
  private attempts: Attempt[] = [];
  private srs = new Map<string, SrsItem>();
  private meta = new Map<string, unknown>();
  private seq = 1;
  private solves = new Map<string, SavedSolve>();
  private ranges = new Map<string, SavedRange>();
  private hands = new Map<string, StoredHand>();

  /** the same records ordered by (ts, id), like the `ts` index of IndexedDB */
  private byTs: Attempt[] = [];

  async addAttempt(a: Attempt) {
    const rec = { ...a, id: this.seq++ };
    this.attempts.push(rec);
    // usually the newest: appended; an older one (a backup, a synced row) goes where its time puts it
    const last = this.byTs[this.byTs.length - 1];
    if (!last || last.ts <= rec.ts) this.byTs.push(rec);
    else this.byTs.splice(firstIndex(this.byTs, (x) => x.ts > rec.ts), 0, rec);
  }
  async allAttempts() {
    return this.attempts.slice();
  }
  async attemptsSince(ts: number) {
    return this.byTs.slice(firstIndex(this.byTs, (x) => x.ts >= ts));
  }
  async attemptsAfterId(id: number) {
    return this.attempts.slice(firstIndex(this.attempts, (x) => (x.id ?? 0) > id));
  }
  async countAttempts() {
    return this.attempts.length;
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
    const meta = Object.fromEntries([...this.meta].filter(([k]) => !isDerivedMetaKey(k)));
    return { app: "tessera", version: 1, exportedAt: Date.now(), attempts: await this.allAttempts(), srs: await this.allSrs(), meta, ranges: await this.listRanges(), hands: await this.listHands() };
  }
  async importAll(file: ExportBlob) {
    if (file?.app !== "tessera") throw new Error("not a Tessera export");
    const { blob: b, report } = currentPart(file);
    for (const a of b.attempts) await this.addAttempt({ ...a, id: undefined });
    for (const s of b.srs) {
      const cur = this.srs.get(s.key);
      if (!cur || cur.updated < s.updated) this.srs.set(s.key, s);
    }
    for (const [k, v] of Object.entries(b.meta)) this.meta.set(k, mergeMeta(k, this.meta.get(k), v));
    for (const r of b.ranges ?? []) await this.putRange(r);
    await this.putHands(b.hands ?? []);
    return report;
  }
  async clear() {
    this.attempts = [];
    this.byTs = [];
    this.srs.clear();
    this.meta.clear();
    this.solves.clear();
    this.ranges.clear();
    this.hands.clear();
  }
  async putSolve(s: SavedSolve) {
    this.solves.set(s.id, s);
  }
  async listSolves() {
    return [...this.solves.values()].sort((a, b) => b.ts - a.ts);
  }
  async getSolve(id: string) {
    return this.solves.get(id);
  }
  async deleteSolve(id: string) {
    this.solves.delete(id);
  }
  async putRange(r: SavedRange) {
    this.ranges.set(r.id, r);
  }
  async listRanges() {
    return [...this.ranges.values()].sort((a, b) => b.ts - a.ts);
  }
  async deleteRange(id: string) {
    this.ranges.delete(id);
  }
  async putHands(list: StoredHand[]) {
    for (const h of list) this.hands.set(h.id, h);
  }
  async listHands() {
    return [...this.hands.values()].sort((a, b) => b.ts - a.ts);
  }
  async deleteHand(id: string) {
    this.hands.delete(id);
  }
  async clearHands() {
    this.hands.clear();
  }
}
