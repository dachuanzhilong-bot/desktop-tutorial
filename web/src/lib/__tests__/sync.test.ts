import { describe, expect, it } from "vitest";
import { MemoryRepo } from "../storage/memory";
import type { Attempt } from "../storage/types";
import { syncOnce, SettingsIo } from "../sync/engine";
import { AuthError, SupabaseAuth, SupabaseBackend } from "../sync/supabase";
import type { AttemptRow, RangeRow, SettingsRow, SrsRow, SyncBackend } from "../sync/types";
import { updateSrs } from "../practice/srs";

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

/** in-memory server with the same semantics the real tables have (unique keys, ignore/merge duplicates) */
class FakeBackend implements SyncBackend {
  attempts: (AttemptRow & { user: string })[] = [];
  srs = new Map<string, SrsRow>();
  ranges = new Map<string, RangeRow>();
  settings: SettingsRow | null = null;
  pushes = 0;
  async pushAttempts(rows: AttemptRow[]) {
    this.pushes++;
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
  const tables: Record<string, Row[]> = { attempts: [], srs_items: [], range_presets: [], user_settings: [] };
  const uniq: Record<string, string[]> = { attempts: ["user_id", "client_id", "ts", "node_id", "hand"], srs_items: ["user_id", "key"], range_presets: ["user_id", "id"], user_settings: ["user_id"] };
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
    a.set({ theme: "light" }, 1_700_000_050_000);
    const r1 = await syncOnce(a.repo, backend, session.userId, a.io);
    expect(r1).toMatchObject({ pushedAttempts: 1203, pushedSrs: 1, pushedRanges: 1, settings: "pushed" });
    expect(srv.tables.attempts).toHaveLength(1203);
    expect(srv.tables.attempts.every((r) => r.user_id === "user-1" && r.client_id)).toBe(true);
    expect(srv.reqs.filter((r) => r.method === "POST" && r.url.startsWith("/rest/v1/attempts"))).toHaveLength(3); // 500 + 500 + 203
    expect(srv.reqs.find((r) => r.url.startsWith("/rest/v1/attempts") && r.method === "POST")!.headers.prefer).toContain("ignore-duplicates");
    expect(srv.reqs.find((r) => r.url.startsWith("/rest/v1/attempts") && r.method === "POST")!.headers.authorization).toBe("Bearer tok1");

    // a second device pulls all 1,203 rows (two pages)
    const b = device();
    const r2 = await syncOnce(b.repo, backend, session.userId, b.io);
    expect(r2.pulledAttempts).toBe(1203);
    expect(r2.pulledSrs).toBe(1);
    expect(r2.settings).toBe("pulled");
    expect(srv.reqs.filter((r) => r.method === "GET" && r.url.startsWith("/rest/v1/attempts")).length).toBeGreaterThanOrEqual(2);

    // running the same upload again does not duplicate anything on the server
    const state = await a.repo.getMeta<Record<string, unknown>>("sync.state.user-1");
    await a.repo.setMeta("sync.state.user-1", { ...state, pushedAttemptId: 0 });
    await syncOnce(a.repo, backend, session.userId, a.io);
    expect(srv.tables.attempts).toHaveLength(1203);
  });

  it("a rejected token is reported as an auth error", async () => {
    const srv = fakeServer();
    const backend = new SupabaseBackend(CFG, { accessToken: "garbage", refreshToken: "", expiresAt: 0, userId: "u", email: "e" }, srv.fetchFn);
    await expect(backend.pullSettings()).rejects.toThrow(AuthError);
  });
});
