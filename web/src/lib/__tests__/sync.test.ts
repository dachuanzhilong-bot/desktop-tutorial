import { describe, expect, it } from "vitest";
import { MemoryRepo } from "../storage/memory";
import type { Attempt } from "../storage/types";
import { readBookmarks, removeBookmark, upsertBookmark } from "../storage/bookmarks";
import type { Bookmark } from "../storage/bookmarks";
import { appendIcmLog, readIcmLog } from "../storage/icmLog";
import type { IcmLogEntry } from "../storage/icmLog";
import { loadState, syncOnce, SettingsIo } from "../sync/engine";
import { AuthError, SupabaseAuth, SupabaseBackend } from "../sync/supabase";
import { attemptToRow, rowToAttempt, rowToSrs, srsToRow } from "../sync/types";
import type { AttemptRow, BookmarkRow, IcmLogRow, RangeRow, SettingsRow, SrsRow, SyncBackend } from "../sync/types";
import { updateSrs } from "../practice/srs";
import { migrationChecks, readSchema, rejectBatch, schemaChecks, violations } from "./fixtures/schemaChecks";

const attempt = (ts: number, nodeId = 5, hand = 10, extra: Partial<Attempt> = {}): Attempt => ({
  ts,
  sessionId: "s1",
  mode: "spot",
  solution: "cash6max-100bb",
  nodeId,
  hand,
  seat: 3,
  spot: "rfi",
  chosen: 1,
  best: 1,
  grade: "best",
  evLoss: 0,
  score: 100,
  ms: 900,
  rng: false,
  timeout: false,
  hint: false,
  ...extra,
});

const bookmark = (o: Partial<Bookmark> = {}): Bookmark => ({ id: "bm1", created: 1_700_000_000_000, ts: 1_700_000_000_000, title: "BTN open", note: "", href: "/study/#d=100&n=3", ...o });
const icmEntry = (o: Partial<IcmLogEntry> = {}): IcmLogEntry => ({ ts: 1_700_000_000_000, players: 3, pos: "BTN", stack: 8, facing: null, hand: 10, chosen: 1, grade: "best", evLoss: 0, score: 100, ...o });

/** the `check` constraints of supabase/schema.sql, read from the file (see fixtures/schemaChecks.ts) */
const ATTEMPT_CHECKS = schemaChecks("attempts");

/** in-memory server with the same semantics the real tables have (unique keys, ignore/merge duplicates, check constraints) */
class FakeBackend implements SyncBackend {
  attempts: (AttemptRow & { user: string })[] = [];
  srs = new Map<string, SrsRow>();
  ranges = new Map<string, RangeRow>();
  icm = new Map<string, IcmLogRow>();
  bookmarks = new Map<string, BookmarkRow>();
  settings: SettingsRow | null = null;
  pushes = 0;
  async pushAttempts(rows: AttemptRow[]) {
    this.pushes++;
    // like the REST backend: a batch with a row that breaks a constraint is refused whole, with a 400
    const refused = rejectBatch("attempts", ATTEMPT_CHECKS, rows as unknown as Record<string, unknown>[]);
    if (refused) throw new Error(`attempts 400: ${JSON.stringify(refused)}`);
    for (const r of rows) if (!this.attempts.some((x) => x.client_id === r.client_id && x.ts === r.ts && x.node_id === r.node_id && x.hand === r.hand)) this.attempts.push({ ...r, user: "u" });
  }
  async pullAttempts(since: string) {
    return this.attempts.filter((a) => a.ts >= since).sort((a, b) => a.ts.localeCompare(b.ts));
  }
  async pushSrs(rows: SrsRow[]) {
    this.pushes++;
    for (const r of rows) this.srs.set(r.key, r);
  }
  async pullSrs(since: string) {
    return [...this.srs.values()].filter((r) => r.updated >= since);
  }
  async pushRanges(rows: RangeRow[]) {
    this.pushes++;
    for (const r of rows) this.ranges.set(r.id, r);
  }
  async pullRanges(since: string) {
    return [...this.ranges.values()].filter((r) => r.ts >= since);
  }
  async pushIcmLog(rows: IcmLogRow[]) {
    this.pushes++;
    for (const r of rows) this.icm.set(`${r.ts}:${r.hand}:${r.chosen}`, r);
  }
  async pullIcmLog(since: string) {
    return [...this.icm.values()].filter((r) => r.ts >= since);
  }
  async pushBookmarks(rows: BookmarkRow[]) {
    this.pushes++;
    for (const r of rows) {
      const have = this.bookmarks.get(r.id);
      if (!have || Date.parse(r.ts) > Date.parse(have.ts) || (r.ts === have.ts && r.deleted && !have.deleted)) this.bookmarks.set(r.id, r);
    }
  }
  async pullBookmarks(since: string) {
    return [...this.bookmarks.values()].filter((r) => r.ts >= since);
  }
  async pushSettings(row: SettingsRow) {
    this.pushes++;
    this.settings = row;
  }
  async pullSettings() {
    return this.settings;
  }
}

function device() {
  let settings = { data: { theme: "dark" } as Record<string, unknown>, updated: 0 };
  const io: SettingsIo = { get: () => settings, apply: (data, updated) => (settings = { data, updated }) };
  return { repo: new MemoryRepo(), io, settings: () => settings, set: (data: Record<string, unknown>, updated: number) => (settings = { data, updated }) };
}

describe("sync engine", () => {
  it("adds the new cursors when it reads an older saved sync state", async () => {
    const a = device();
    await a.repo.setMeta("sync.state.u", { clientId: "old-client", pushedAttemptId: 4, pullAttemptTs: 9, pushedSrs: 8, pullSrs: 7, pushedRanges: 6, pullRanges: 5, lastSync: 4 });
    expect(await loadState(a.repo, "u")).toMatchObject({ clientId: "old-client", pushedAttemptId: 4, pushedIcmKeys: [], pullIcmTs: 0, bookmarkTs: {}, pullBookmarkTs: 0 });
  });

  it("two devices converge without echo or duplicates", async () => {
    const server = new FakeBackend();
    const a = device();
    const b = device();
    await a.repo.addAttempt(attempt(1_700_000_000_000, 5, 10));
    await a.repo.addAttempt(attempt(1_700_000_001_000, 6, 11, { grade: "mistake", evLoss: 0.4 }));
    await b.repo.addAttempt(attempt(1_700_000_002_000, 7, 12));

    const r1 = await syncOnce(a.repo, server, "u", a.io);
    expect(r1.pushedAttempts).toBe(2);
    const r2 = await syncOnce(b.repo, server, "u", b.io);
    expect(r2.pushedAttempts).toBe(1);
    expect(r2.pulledAttempts).toBe(2);
    await syncOnce(a.repo, server, "u", a.io);

    const keys = async (d: ReturnType<typeof device>) => (await d.repo.allAttempts()).map((x) => `${x.ts}:${x.nodeId}:${x.hand}`).sort();
    expect(await keys(a)).toEqual(await keys(b));
    expect(await keys(a)).toHaveLength(3);
    expect(server.attempts).toHaveLength(3);
    // the mistake survived the trip with all its fields
    const mine = (await b.repo.allAttempts()).find((x) => x.nodeId === 6)!;
    expect(mine).toMatchObject({ grade: "mistake", evLoss: 0.4, remote: true, ms: 900, rng: false });

    // a further round with nothing new moves nothing
    const before = server.pushes;
    const idle = await syncOnce(a.repo, server, "u", a.io);
    expect(idle).toMatchObject({ pushedAttempts: 0, pulledAttempts: 0, pushedSrs: 0, pulledSrs: 0 });
    expect(server.pushes).toBe(before);
  });

  it("flags and nullable fields survive (rng, timeout, hint)", async () => {
    const server = new FakeBackend();
    const a = device();
    const b = device();
    await a.repo.addAttempt(attempt(1_700_000_000_000, 1, 1, { rng: true, timeout: true, hint: true }));
    await syncOnce(a.repo, server, "u", a.io);
    await syncOnce(b.repo, server, "u", b.io);
    expect((await b.repo.allAttempts())[0]).toMatchObject({ rng: true, timeout: true, hint: true });
  });

  it("spaced repetition: the newer record wins on both sides", async () => {
    const server = new FakeBackend();
    const a = device();
    const b = device();
    const t0 = 1_700_000_000_000;
    await a.repo.putSrs(updateSrs(undefined, 5, 10, "best", t0));
    await syncOnce(a.repo, server, "u", a.io);
    await syncOnce(b.repo, server, "u", b.io);
    expect((await b.repo.allSrs())[0].seen).toBe(1);

    // both practise the same item; B later than A
    await a.repo.putSrs(updateSrs((await a.repo.allSrs())[0], 5, 10, "mistake", t0 + 1000));
    await b.repo.putSrs(updateSrs((await b.repo.allSrs())[0], 5, 10, "best", t0 + 5000));
    await syncOnce(a.repo, server, "u", a.io);
    await syncOnce(b.repo, server, "u", b.io);
    await syncOnce(a.repo, server, "u", a.io);
    const ia = (await a.repo.allSrs())[0];
    const ib = (await b.repo.allSrs())[0];
    expect(ia).toEqual(ib);
    expect(ia.updated).toBe(t0 + 5000);
    expect(ia.lastGrade).toBe("best");
  });

  it("named ranges travel; settings: the newer change wins", async () => {
    const server = new FakeBackend();
    const a = device();
    const b = device();
    await a.repo.putRange({ id: "r1", ts: 1_700_000_000_000, name: "open", text: "22+,A2s+" });
    a.set({ theme: "light", lang: "en" }, 1_700_000_100_000);
    const r = await syncOnce(a.repo, server, "u", a.io);
    expect(r.settings).toBe("pushed");
    expect(r.pushedRanges).toBe(1);

    const rb = await syncOnce(b.repo, server, "u", b.io);
    expect(rb.settings).toBe("pulled");
    expect(b.settings().data).toEqual({ theme: "light", lang: "en" });
    expect((await b.repo.listRanges())[0]).toMatchObject({ id: "r1", name: "open", text: "22+,A2s+" });

    // B changes a setting later, A syncs and receives it
    b.set({ theme: "dark", lang: "en" }, 1_700_000_200_000);
    await syncOnce(b.repo, server, "u", b.io);
    const ra = await syncOnce(a.repo, server, "u", a.io);
    expect(ra.settings).toBe("pulled");
    expect(a.settings().data).toEqual({ theme: "dark", lang: "en" });
    // an untouched device never overwrites the server's settings
    const c = device();
    expect((await syncOnce(c.repo, server, "u", c.io)).settings).toBe("pulled");
  });

  it("syncs ICM answers and saved positions, with notes and deletions converging without echo", async () => {
    const server = new FakeBackend();
    const a = device();
    const b = device();
    const t0 = 1_700_000_000_000;
    await appendIcmLog(a.repo, icmEntry({ ts: t0, hand: 22, grade: "mistake", evLoss: 1.4 }));
    await upsertBookmark(a.repo, bookmark({ ts: t0, created: t0, note: "check the turn" }));

    const first = await syncOnce(a.repo, server, "u", a.io);
    expect(first).toMatchObject({ pushedIcmLog: 1, pushedBookmarks: 1 });
    expect(server.icm.size).toBe(1);
    expect(server.bookmarks.get("bm1")).toMatchObject({ deleted: false, note: "check the turn" });

    const pulled = await syncOnce(b.repo, server, "u", b.io);
    expect(pulled).toMatchObject({ pulledIcmLog: 1, pulledBookmarks: 1, pushedIcmLog: 0, pushedBookmarks: 0 });
    expect(await readIcmLog(b.repo)).toMatchObject([{ hand: 22, grade: "mistake", evLoss: 1.4 }]);
    expect(await readBookmarks(b.repo)).toMatchObject([{ id: "bm1", note: "check the turn" }]);
    expect(await syncOnce(b.repo, server, "u", b.io)).toMatchObject({ pushedIcmLog: 0, pushedBookmarks: 0, pulledIcmLog: 0, pulledBookmarks: 0 });

    await upsertBookmark(b.repo, bookmark({ ts: t0 + 2_000, created: t0, note: "newer note" }));
    await syncOnce(b.repo, server, "u", b.io);
    await syncOnce(a.repo, server, "u", a.io);
    expect((await readBookmarks(a.repo))[0].note).toBe("newer note");

    const backupBeforeDelete = await b.repo.exportAll();
    await removeBookmark(b.repo, "bm1");
    expect((await syncOnce(b.repo, server, "u", b.io)).pushedBookmarks).toBe(1);
    await syncOnce(a.repo, server, "u", a.io);
    expect(await readBookmarks(a.repo)).toEqual([]);
    expect(server.bookmarks.get("bm1")).toMatchObject({ deleted: true, title: null, href: null });

    // An old backup and an old device copy cannot undo the deletion.
    await a.repo.importAll(backupBeforeDelete);
    expect(await readBookmarks(a.repo)).toEqual([]);
    expect((await syncOnce(a.repo, server, "u", a.io)).pushedBookmarks).toBe(0);
    expect(server.bookmarks.get("bm1")?.deleted).toBe(true);
  });

  it("pulls a bookmark that arrives later with a timestamp behind the previous cursor", async () => {
    const server = new FakeBackend();
    const a = device();
    const recent = bookmark({ id: "recent", ts: 1_700_000_100_000, created: 1_700_000_100_000 });
    server.bookmarks.set(recent.id, {
      id: recent.id,
      created: new Date(recent.created).toISOString(),
      ts: new Date(recent.ts).toISOString(),
      deleted: false,
      title: recent.title,
      note: recent.note,
      href: recent.href,
    });
    await syncOnce(a.repo, server, "u", a.io);

    const late = bookmark({ id: "late", ts: 1_700_000_050_000, created: 1_700_000_050_000, title: "Late bookmark" });
    server.bookmarks.set(late.id, {
      id: late.id,
      created: new Date(late.created).toISOString(),
      ts: new Date(late.ts).toISOString(),
      deleted: false,
      title: late.title,
      note: late.note,
      href: late.href,
    });
    const result = await syncOnce(a.repo, server, "u", a.io);
    expect(result.pulledBookmarks).toBe(1);
    expect(await readBookmarks(a.repo)).toContainEqual(expect.objectContaining({ id: "late", title: "Late bookmark" }));
  });

  it("post-flop answers (mode postSpot, hand 1325) are pushed by one device and pulled by another", async () => {
    const server = new FakeBackend();
    const a = device();
    const b = device();
    // a post-flop answer stores the combo number (0..1325) in `hand`; the last combo is the edge of the range
    const post = (ts: number, hand: number, extra: Partial<Attempt> = {}) =>
      attempt(ts, 40, hand, { mode: "postSpot", solution: "post:srp-btn-bb/3", seat: 5, spot: "postFlop", ...extra });
    await a.repo.addAttempt(post(1_700_000_000_000, 1325));
    await a.repo.addAttempt(post(1_700_000_001_000, 169, { mode: "post", spot: "postTurn", grade: "mistake", evLoss: 1.2, score: 40 })); // the first number a pre-flop class never uses
    await a.repo.addAttempt(attempt(1_700_000_002_000, 5, 168)); // a pre-flop answer in the same batch

    expect((await syncOnce(a.repo, server, "u", a.io)).pushedAttempts).toBe(3);
    expect(server.attempts.map((r) => r.hand).sort((x, y) => x - y)).toEqual([168, 169, 1325]);

    expect((await syncOnce(b.repo, server, "u", b.io)).pulledAttempts).toBe(3);
    const got = await b.repo.allAttempts();
    expect(got).toHaveLength(3);
    expect(got).toContainEqual(expect.objectContaining({ mode: "postSpot", hand: 1325, solution: "post:srp-btn-bb/3", spot: "postFlop", seat: 5, remote: true }));
    expect(got).toContainEqual(expect.objectContaining({ mode: "post", hand: 169, spot: "postTurn", grade: "mistake", evLoss: 1.2 }));
  });

  it("the position key and the build ID travel: pushed by one device, pulled by another, next to records without them", async () => {
    const server = new FakeBackend();
    const a = device();
    const b = device();
    const t0 = 1_700_000_000_000;
    await a.repo.addAttempt(attempt(t0, 12, 34, { pos: "F-F-R2.5-F-F", build: "17035ecae421" }));
    await a.repo.addAttempt(attempt(t0 + 1000, 40, 1325, { mode: "postSpot", solution: "post:srp-btn-bb", seat: 5, spot: "postTurn", pos: "9s6d3c@X-B1.75-C/Td", build: "fd91cfc9e86b" }));
    await a.repo.addAttempt(attempt(t0 + 2000, 5, 10)); // made before position keys
    const preItem = updateSrs(undefined, 12, 34, "mistake", t0, undefined, { solution: "cash6max-100bb", pos: "F-F-R2.5-F-F", build: "17035ecae421" });
    const postItem = updateSrs(undefined, 40, 1325, "best", t0 + 1000, undefined, { solution: "post:srp-btn-bb", pos: "9s6d3c@X-B1.75-C/Td", build: "fd91cfc9e86b" });
    const oldItem = updateSrs(undefined, 5, 10, "best", t0 + 2000);
    for (const it of [preItem, postItem, oldItem]) await a.repo.putSrs(it);
    expect(preItem.key).toBe("k:cash6max-100bb:F-F-R2.5-F-F:34");

    expect(await syncOnce(a.repo, server, "u", a.io)).toMatchObject({ pushedAttempts: 3, pushedSrs: 3 });
    // every row of an upload has the same columns: null where a record has no position
    expect(server.attempts.map((r) => [r.pos, r.build])).toEqual([["F-F-R2.5-F-F", "17035ecae421"], ["9s6d3c@X-B1.75-C/Td", "fd91cfc9e86b"], [null, null]]);
    expect(server.srs.get(preItem.key)).toMatchObject({ solution: "cash6max-100bb", pos: "F-F-R2.5-F-F", build: "17035ecae421" });
    expect(server.srs.get(oldItem.key)).toMatchObject({ solution: null, pos: null, build: null });

    expect(await syncOnce(b.repo, server, "u", b.io)).toMatchObject({ pulledAttempts: 3, pulledSrs: 3 });
    const got = await b.repo.allAttempts();
    expect(got).toContainEqual(expect.objectContaining({ ts: t0, nodeId: 12, hand: 34, pos: "F-F-R2.5-F-F", build: "17035ecae421", remote: true }));
    expect(got).toContainEqual(expect.objectContaining({ ts: t0 + 1000, solution: "post:srp-btn-bb", pos: "9s6d3c@X-B1.75-C/Td", build: "fd91cfc9e86b" }));
    const old = got.find((x) => x.ts === t0 + 2000)!;
    expect("pos" in old).toBe(false);
    expect("build" in old).toBe(false);
    // spaced repetition: exactly the items of the first device (an old one has no position fields at all)
    const srs = await b.repo.allSrs();
    expect(srs).toHaveLength(3);
    expect(srs).toContainEqual(preItem);
    expect(srs).toContainEqual(postItem);
    expect(srs).toContainEqual(oldItem);
    // nothing echoes back
    expect(await syncOnce(a.repo, server, "u", a.io)).toMatchObject({ pushedAttempts: 0, pulledAttempts: 0 });
    expect(await a.repo.allAttempts()).toHaveLength(3);
  });

  it("rows of a server that does not have the new columns yet are read as records without a position", () => {
    const row = attemptToRow(attempt(1_700_000_000_000, 5, 10, { pos: "root", build: "abc" }), "c1");
    const { pos: _pos, build: _build, ...oldRow } = row;
    const back = rowToAttempt(oldRow);
    expect(back).toMatchObject({ nodeId: 5, hand: 10, remote: true });
    expect("pos" in back).toBe(false);
    expect(rowToAttempt(row)).toMatchObject({ pos: "root", build: "abc" });
    const item = updateSrs(undefined, 5, 10, "best", 1_700_000_000_000, undefined, { solution: "cash6max-100bb", pos: "root", build: "abc" });
    const { solution: _s, pos: _p, build: _b, ...oldSrsRow } = srsToRow(item);
    const { solution: _s2, pos: _p2, build: _b2, ...plain } = item;
    expect(rowToSrs(oldSrsRow)).toEqual(plain);
    expect(rowToSrs(srsToRow(item))).toEqual(item);
  });

  it("the fake server refuses what the schema refuses: a row outside a constraint fails the whole batch", async () => {
    const server = new FakeBackend();
    const a = device();
    await a.repo.addAttempt(attempt(1_700_000_000_000, 5, 10));
    await a.repo.addAttempt(attempt(1_700_000_001_000, 6, 1326, { mode: "postSpot" })); // one past the last combo
    await expect(syncOnce(a.repo, server, "u", a.io)).rejects.toThrow(/attempts 400.*attempts_hand_check/);
    expect(server.attempts).toHaveLength(0); // nothing of the batch was stored

    // every other column the schema limits is enforced too
    const row = { ...(await a.repo.allAttempts())[0] };
    const bad = (extra: Partial<Attempt>) => server.pushAttempts([attemptToRow({ ...row, ...extra }, "c")]);
    await expect(bad({ seat: 6 })).rejects.toThrow(/attempts_seat_check/);
    await expect(bad({ mode: "bogus" as Attempt["mode"] })).rejects.toThrow(/attempts_mode_check/);
    await expect(bad({ grade: "ok" as Attempt["grade"] })).rejects.toThrow(/attempts_grade_check/);
    await expect(bad({ score: 101 })).rejects.toThrow(/attempts_score_check/);
    await expect(bad({ evLoss: -0.01 })).rejects.toThrow(/attempts_ev_loss_check/);
    await expect(bad({ hand: -1 })).rejects.toThrow(/attempts_hand_check/);
    await expect(bad({})).resolves.toBeUndefined();
  });

  it("a failing server leaves the cursors alone so the next round retries", async () => {
    const server = new FakeBackend();
    const a = device();
    await a.repo.addAttempt(attempt(1_700_000_000_000));
    const original = server.pushAttempts.bind(server);
    server.pushAttempts = async () => {
      throw new Error("offline");
    };
    await expect(syncOnce(a.repo, server, "u", a.io)).rejects.toThrow("offline");
    server.pushAttempts = original;
    expect((await syncOnce(a.repo, server, "u", a.io)).pushedAttempts).toBe(1);
  });
});

// ------------------------------------------------------------------ REST + auth against a fake PostgREST / GoTrue

interface Req {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Row = Record<string, unknown>;

function fakeServer() {
  const reqs: Req[] = [];
  const tables: Record<string, Row[]> = { attempts: [], srs_items: [], range_presets: [], icm_drill_log: [], study_bookmarks: [], user_settings: [] };
  const uniq: Record<string, string[]> = { attempts: ["user_id", "client_id", "ts", "node_id", "hand"], srs_items: ["user_id", "key"], range_presets: ["user_id", "id"], icm_drill_log: ["user_id", "ts", "hand", "chosen"], study_bookmarks: ["user_id", "id"], user_settings: ["user_id"] };
  const checks: Record<string, ReturnType<typeof schemaChecks>> = { attempts: ATTEMPT_CHECKS };
  let auth: Row | null = null;
  const json = (status: number, body: unknown) => new Response(body === null ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    reqs.push({ url: url.pathname + url.search, method: init.method ?? "GET", headers, body });
    if (!headers.apikey) return json(401, { message: "no key" });
    if (url.pathname === "/auth/v1/otp") return json(200, {});
    if (url.pathname === "/auth/v1/verify") {
      if (body.token !== "123456") return json(403, { msg: "Token has expired or is invalid" });
      auth = { access_token: "tok1", refresh_token: "ref1", expires_in: 3600, user: { id: "user-1", email: body.email } };
      return json(200, auth);
    }
    if (url.pathname === "/auth/v1/token") return body.refresh_token === "ref1" ? json(200, { ...auth, access_token: "tok2", refresh_token: "ref2" }) : json(400, { error_description: "Invalid Refresh Token" });
    if (url.pathname === "/auth/v1/logout") return json(204, null);
    if (!url.pathname.startsWith("/rest/v1/")) return json(404, {});
    if (!/^Bearer tok\d$/.test(headers.authorization ?? "")) return json(401, { message: "JWT" });
    const table = url.pathname.replace("/rest/v1/", "");
    const rows = tables[table];
    if ((init.method ?? "GET") === "POST") {
      const conflict = (url.searchParams.get("on_conflict") ?? "").split(",");
      expect(conflict).toEqual(uniq[table]);
      const refused = checks[table] ? rejectBatch(table, checks[table], body as Row[]) : null;
      if (refused) return json(400, refused);
      for (const r of body as Row[]) {
        const i = rows.findIndex((x) => conflict.every((c) => x[c] === r[c]));
        if (i < 0) rows.push({ id: rows.length + 1, ...r });
        else if (/merge-duplicates/.test(headers.prefer)) rows[i] = { ...rows[i], ...r };
        else expect(headers.prefer).toMatch(/ignore-duplicates/);
      }
      return json(201, null);
    }
    // GET with a "<col>=gte.<iso>" filter, order and paging
    let out = [...rows];
    for (const [k, v] of url.searchParams) if (v.startsWith("gte.")) out = out.filter((r) => String(r[k]) >= v.slice(4));
    const order = (url.searchParams.get("order") ?? "").split(",")[0].split(".")[0];
    if (order) out.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
    const off = Number(url.searchParams.get("offset") ?? 0);
    const lim = Number(url.searchParams.get("limit") ?? 1000);
    return json(200, out.slice(off, off + lim));
  }) as typeof fetch;
  return { reqs, tables, fetchFn };
}

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const CFG = { url: "https://example.supabase.co/", anonKey: "anon-key" };

describe("Supabase over fetch", () => {
  it("e-mail code login stores a session and refreshes it when it expires", async () => {
    const srv = fakeServer();
    let now = 1_700_000_000_000;
    const auth = new SupabaseAuth(CFG, srv.fetchFn, memStore(), () => now);
    expect(await auth.session()).toBeNull();
    await auth.sendCode("me@example.com");
    expect(srv.reqs[0]).toMatchObject({ url: "/auth/v1/otp", method: "POST", body: { email: "me@example.com", create_user: true } });
    expect(srv.reqs[0].headers.apikey).toBe("anon-key");
    await expect(auth.verifyCode("me@example.com", "000000")).rejects.toThrow(/invalid/i);
    const s = await auth.verifyCode("me@example.com", " 123456 ");
    expect(s).toMatchObject({ accessToken: "tok1", userId: "user-1", email: "me@example.com" });
    expect((await auth.session())!.accessToken).toBe("tok1");
    now += 3_590_000; // inside the 60 s refresh window
    expect((await auth.session())!.accessToken).toBe("tok2");
    await auth.signOut();
    expect(await auth.session()).toBeNull();
    expect(srv.reqs.at(-1)!.url).toBe("/auth/v1/logout");
  });

  it("a rejected refresh token signs the user out; a network error keeps the session", async () => {
    const srv = fakeServer();
    let now = 1_700_000_000_000;
    const store = memStore();
    const auth = new SupabaseAuth(CFG, srv.fetchFn, store, () => now);
    await auth.verifyCode("me@example.com", "123456");
    now += 4_000_000;
    const offline = new SupabaseAuth(CFG, (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch, store, () => now);
    await expect(offline.session()).rejects.toThrow(TypeError);
    expect(offline.stored()).not.toBeNull();
    store.setItem("tessera.auth.v1", JSON.stringify({ ...JSON.parse(store.getItem("tessera.auth.v1")!), refreshToken: "bad" }));
    await expect(auth.session()).rejects.toThrow(AuthError);
    expect(auth.stored()).toBeNull();
  });

  it("syncs through the REST backend: upsert semantics, paging and the user id on every row", async () => {
    const srv = fakeServer();
    const auth = new SupabaseAuth(CFG, srv.fetchFn, memStore());
    const session = await auth.verifyCode("me@example.com", "123456");
    const backend = new SupabaseBackend(CFG, session, srv.fetchFn);

    const a = device();
    for (let i = 0; i < 1203; i++) await a.repo.addAttempt(attempt(1_700_000_000_000 + i * 1000, i % 50, i % 169));
    await a.repo.putSrs(updateSrs(undefined, 5, 10, "mistake", 1_700_000_000_000));
    await a.repo.putRange({ id: "r1", ts: 1_700_000_000_000, name: "x", text: "AA" });
    await appendIcmLog(a.repo, icmEntry({ ts: 1_700_000_000_000, hand: 77 }));
    await upsertBookmark(a.repo, bookmark({ id: "b1", ts: 1_700_000_000_000, created: 1_700_000_000_000 }));
    a.set({ theme: "light" }, 1_700_000_050_000);
    const r1 = await syncOnce(a.repo, backend, session.userId, a.io);
    expect(r1).toMatchObject({ pushedAttempts: 1203, pushedSrs: 1, pushedRanges: 1, pushedIcmLog: 1, pushedBookmarks: 1, settings: "pushed" });
    expect(srv.tables.attempts).toHaveLength(1203);
    expect(srv.tables.attempts.every((r) => r.user_id === "user-1" && r.client_id)).toBe(true);
    expect(srv.tables.icm_drill_log).toHaveLength(1);
    expect(srv.tables.icm_drill_log[0]).toMatchObject({ user_id: "user-1", hand: 77 });
    expect(srv.tables.study_bookmarks).toHaveLength(1);
    expect(srv.tables.study_bookmarks[0]).toMatchObject({ user_id: "user-1", id: "b1", deleted: false });
    expect(srv.reqs.filter((r) => r.method === "POST" && r.url.startsWith("/rest/v1/attempts"))).toHaveLength(3); // 500 + 500 + 203
    expect(srv.reqs.find((r) => r.url.startsWith("/rest/v1/attempts") && r.method === "POST")!.headers.prefer).toContain("ignore-duplicates");
    expect(srv.reqs.find((r) => r.url.startsWith("/rest/v1/attempts") && r.method === "POST")!.headers.authorization).toBe("Bearer tok1");
    expect(srv.reqs.find((r) => r.url.startsWith("/rest/v1/icm_drill_log") && r.method === "POST")!.headers.prefer).toContain("ignore-duplicates");
    expect(srv.reqs.find((r) => r.url.startsWith("/rest/v1/study_bookmarks") && r.method === "POST")!.headers.prefer).toContain("merge-duplicates");

    // a second device pulls all 1,203 rows (two pages)
    const b = device();
    const r2 = await syncOnce(b.repo, backend, session.userId, b.io);
    expect(r2).toMatchObject({ pulledAttempts: 1203, pulledIcmLog: 1, pulledBookmarks: 1 });
    expect(r2.pulledSrs).toBe(1);
    expect(r2.settings).toBe("pulled");
    expect(srv.reqs.filter((r) => r.method === "GET" && r.url.startsWith("/rest/v1/attempts")).length).toBeGreaterThanOrEqual(2);

    // running the same upload again does not duplicate anything on the server
    const state = await a.repo.getMeta<Record<string, unknown>>("sync.state.user-1");
    await a.repo.setMeta("sync.state.user-1", { ...state, pushedAttemptId: 0 });
    await syncOnce(a.repo, backend, session.userId, a.io);
    expect(srv.tables.attempts).toHaveLength(1203);
  });

  it("post-flop answers go through the REST backend; a batch that breaks a constraint gets a 400 and stores nothing", async () => {
    const srv = fakeServer();
    const auth = new SupabaseAuth(CFG, srv.fetchFn, memStore());
    const session = await auth.verifyCode("me@example.com", "123456");
    const backend = new SupabaseBackend(CFG, session, srv.fetchFn);

    const a = device();
    await a.repo.addAttempt(attempt(1_700_000_000_000, 40, 1325, { mode: "postSpot", solution: "post:srp-btn-bb/3", spot: "postFlop", seat: 5 }));
    expect((await syncOnce(a.repo, backend, session.userId, a.io)).pushedAttempts).toBe(1);
    expect(srv.tables.attempts).toHaveLength(1);
    expect(srv.tables.attempts[0]).toMatchObject({ user_id: "user-1", mode: "postSpot", hand: 1325 });

    const b = device();
    expect((await syncOnce(b.repo, backend, session.userId, b.io)).pulledAttempts).toBe(1);
    expect(await b.repo.allAttempts()).toContainEqual(expect.objectContaining({ mode: "postSpot", hand: 1325, remote: true }));

    // the same server, with a row the schema does not allow: 400, nothing of the batch stored, the error says which constraint
    await a.repo.addAttempt(attempt(1_700_000_001_000, 40, 1326, { mode: "postSpot" }));
    await expect(syncOnce(a.repo, backend, session.userId, a.io)).rejects.toThrow(/attempts 400.*attempts_hand_check/);
    expect(srv.tables.attempts).toHaveLength(1);
  });

  it("the position key and the build ID go through the REST backend and come back on another device", async () => {
    const srv = fakeServer();
    const auth = new SupabaseAuth(CFG, srv.fetchFn, memStore());
    const session = await auth.verifyCode("me@example.com", "123456");
    const backend = new SupabaseBackend(CFG, session, srv.fetchFn);
    const t0 = 1_700_000_000_000;
    const a = device();
    await a.repo.addAttempt(attempt(t0, 12, 34, { pos: "F-F-R2.5-F-F", build: "17035ecae421" }));
    await a.repo.addAttempt(attempt(t0 + 1000, 5, 10)); // made before position keys
    const item = updateSrs(undefined, 40, 1325, "mistake", t0, undefined, { solution: "post:srp-btn-bb", pos: "9s6d3c@X-B1.75-C/Td", build: "fd91cfc9e86b" });
    await a.repo.putSrs(item);
    await syncOnce(a.repo, backend, session.userId, a.io);
    expect(srv.tables.attempts).toHaveLength(2);
    expect(srv.tables.attempts[0]).toMatchObject({ node_id: 12, pos: "F-F-R2.5-F-F", build: "17035ecae421" });
    expect(srv.tables.attempts[1]).toMatchObject({ node_id: 5, pos: null, build: null });
    // one upload, one set of columns (PostgREST takes the columns of a bulk insert from its first row)
    expect(Object.keys(srv.tables.attempts[1]).sort()).toEqual(Object.keys(srv.tables.attempts[0]).sort());
    expect(srv.tables.srs_items[0]).toMatchObject({ key: item.key, solution: "post:srp-btn-bb", pos: "9s6d3c@X-B1.75-C/Td", build: "fd91cfc9e86b" });

    const b = device();
    expect(await syncOnce(b.repo, backend, session.userId, b.io)).toMatchObject({ pulledAttempts: 2, pulledSrs: 1 });
    expect(await b.repo.allAttempts()).toContainEqual(expect.objectContaining({ ts: t0, pos: "F-F-R2.5-F-F", build: "17035ecae421" }));
    expect(await b.repo.allSrs()).toEqual([item]);
  });

  it("a rejected token is reported as an auth error", async () => {
    const srv = fakeServer();
    const backend = new SupabaseBackend(CFG, { accessToken: "garbage", refreshToken: "", expiresAt: 0, userId: "u", email: "e" }, srv.fetchFn);
    await expect(backend.pullSettings()).rejects.toThrow(AuthError);
  });
});

// ------------------------------------------------------------------ the constraints the fakes enforce come from supabase/schema.sql

describe("supabase/schema.sql check constraints", () => {
  const byColumn = (table: string) => Object.fromEntries(schemaChecks(table).map((c) => [c.column, c.rule]));

  it("attempts: the hand column holds a pre-flop class or a post-flop combo (0..1325), and the other columns keep their limits", () => {
    expect(byColumn("attempts")).toEqual({
      mode: "mode in ('spot','hand','post','postSpot')",
      hand: "hand between 0 and 1325",
      seat: "seat between 0 and 5",
      grade: "grade in ('best','correct','inaccurate','mistake','blunder')",
      ev_loss: "ev_loss >= 0",
      score: "score between 0 and 100",
    });
    expect(violations(ATTEMPT_CHECKS, { mode: "postSpot", hand: 1325, seat: 0, grade: "best", ev_loss: 0, score: 100 })).toEqual([]);
    expect(violations(ATTEMPT_CHECKS, { mode: "postSpot", hand: 1326, seat: 0, grade: "best", ev_loss: 0, score: 100 })).toEqual(["attempts_hand_check: hand between 0 and 1325"]);
  });

  it("the fix for a database made from an older copy of the file leaves the same limit as the create statement", () => {
    const created = schemaChecks("attempts").find((c) => c.column === "hand")!;
    const altered = migrationChecks("attempts");
    expect(altered).toHaveLength(1);
    expect(altered[0].name).toBe(created.name);
    expect(altered[0].rule).toBe(created.rule);
  });

  it("attempts and srs_items have the position columns, nullable and without a constraint, also for a database made from an older copy", () => {
    const sql = readSchema();
    const table = (name: string) => new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`).exec(sql)![1];
    for (const [name, columns] of [["attempts", ["pos", "build"]], ["srs_items", ["solution", "pos", "build"]]] as const) {
      for (const c of columns) {
        // in the create statement: plain `text`, so null is allowed and nothing is checked
        expect(table(name)).toMatch(new RegExp(`\\n\\s+${c}\\s+text,`));
        // and idempotently for an existing table
        expect(sql).toContain(`alter table public.${name} add column if not exists ${c} text;`);
      }
      expect(schemaChecks(name).map((k) => k.column)).not.toEqual(expect.arrayContaining([...columns]));
    }
  });

  it("the other tables are still read (a constraint the reader does not understand must not pass silently)", () => {
    expect(byColumn("icm_drill_log")).toMatchObject({ hand: "hand between 0 and 168", chosen: "chosen in (0,1)", players: "players between 2 and 9" });
    expect(() => schemaChecks("no_such_table")).toThrow(/not in the schema/);
    expect(() => schemaChecks("t", "create table if not exists public.t (\n  a int check (a % 2 = 0)\n);")).toThrow(/unsupported check/);
  });
});
