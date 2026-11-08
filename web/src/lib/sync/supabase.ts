/**
 * Supabase over plain `fetch` (GoTrue for e-mail one-time-code login, PostgREST for the tables in supabase/schema.sql).
 * No SDK: the app stays dependency-light and the whole thing is testable with a fake `fetch`.
 * Only the public anon key is used; row-level security restricts every row to its owner.
 */
import type { AttemptRow, RangeRow, SettingsRow, SrsRow, SyncBackend } from "./types";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
  userId: string;
  email: string;
}

type FetchFn = typeof fetch;

export class AuthError extends Error {}

const SESSION_KEY = "tessera.auth.v1";
const PAGE = 1000;

function trim(url: string) {
  return url.replace(/\/+$/, "");
}

/** e-mail one-time-code login: no password to store, no redirect URL needed in a static app */
export class SupabaseAuth {
  constructor(
    private cfg: SupabaseConfig,
    private f: FetchFn = (...a) => fetch(...a),
    private store: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
    private now: () => number = () => Date.now(),
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.cfg.anonKey, "Content-Type": "application/json", ...extra };
  }

  private async post(path: string, body: unknown) {
    const res = await this.f(`${trim(this.cfg.url)}${path}`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    if (!res.ok) throw new AuthError(json?.msg ?? json?.error_description ?? json?.message ?? `auth ${res.status}`);
    return json;
  }

  /** sends a 6-digit code to the address (creates the account on first use) */
  async sendCode(email: string): Promise<void> {
    await this.post("/auth/v1/otp", { email, create_user: true });
  }

  async verifyCode(email: string, code: string): Promise<Session> {
    const j = await this.post("/auth/v1/verify", { type: "email", email, token: code.trim() });
    return this.save(j, email);
  }

  private save(j: any, fallbackEmail: string): Session {
    const s: Session = {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: j.expires_at ? j.expires_at * 1000 : this.now() + (j.expires_in ?? 3600) * 1000,
      userId: j.user?.id,
      email: j.user?.email ?? fallbackEmail,
    };
    if (!s.accessToken || !s.userId) throw new AuthError("unexpected response from the auth server");
    this.store?.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }

  stored(): Session | null {
    try {
      const raw = this.store?.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }

  /** a valid session (refreshing the access token when it is about to expire), or null when signed out */
  async session(): Promise<Session | null> {
    const s = this.stored();
    if (!s) return null;
    if (s.expiresAt - this.now() > 60_000) return s;
    try {
      const j = await this.post("/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refreshToken });
      return this.save(j, s.email);
    } catch (e) {
      // a rejected refresh token means the session is gone; a network error (TypeError from fetch) keeps it for the next try
      if (e instanceof AuthError) this.store?.removeItem(SESSION_KEY);
      throw e;
    }
  }

  async signOut(): Promise<void> {
    const s = this.stored();
    this.store?.removeItem(SESSION_KEY);
    if (s) {
      try {
        await this.f(`${trim(this.cfg.url)}/auth/v1/logout`, { method: "POST", headers: this.headers({ Authorization: `Bearer ${s.accessToken}` }) });
      } catch {
        /* best effort */
      }
    }
  }
}

export class SupabaseBackend implements SyncBackend {
  constructor(
    private cfg: SupabaseConfig,
    private session: Session,
    private f: FetchFn = (...a) => fetch(...a),
  ) {}

  private async rest(path: string, init: RequestInit & { prefer?: string } = {}): Promise<any> {
    const headers: Record<string, string> = {
      apikey: this.cfg.anonKey,
      Authorization: `Bearer ${this.session.accessToken}`,
      "Content-Type": "application/json",
    };
    if (init.prefer) headers.Prefer = init.prefer;
    const res = await this.f(`${trim(this.cfg.url)}/rest/v1/${path}`, { method: init.method ?? "GET", headers, body: init.body });
    if (res.status === 401 || res.status === 403) throw new AuthError(`not authorised (${res.status})`);
    if (!res.ok) throw new Error(`${path.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  private withUser<T extends object>(rows: T[]) {
    return rows.map((r) => ({ ...r, user_id: this.session.userId }));
  }

  private async pull<T>(table: string, column: string, sinceIso: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page: T[] = await this.rest(`${table}?select=*&${column}=gte.${encodeURIComponent(sinceIso)}&order=${order}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  private async pushBatches(path: string, rows: object[], prefer: string) {
    for (let i = 0; i < rows.length; i += 500) await this.rest(path, { method: "POST", body: JSON.stringify(this.withUser(rows.slice(i, i + 500))), prefer });
  }

  pushAttempts(rows: AttemptRow[]) {
    return this.pushBatches("attempts?on_conflict=user_id,client_id,ts,node_id,hand", rows, "resolution=ignore-duplicates,return=minimal");
  }
  pullAttempts(sinceIso: string) {
    return this.pull<AttemptRow>("attempts", "ts", sinceIso, "ts.asc,id.asc");
  }
  pushSrs(rows: SrsRow[]) {
    return this.pushBatches("srs_items?on_conflict=user_id,key", rows, "resolution=merge-duplicates,return=minimal");
  }
  pullSrs(sinceIso: string) {
    return this.pull<SrsRow>("srs_items", "updated", sinceIso, "updated.asc,key.asc");
  }
  pushRanges(rows: RangeRow[]) {
    return this.pushBatches("range_presets?on_conflict=user_id,id", rows, "resolution=merge-duplicates,return=minimal");
  }
  pullRanges(sinceIso: string) {
    return this.pull<RangeRow>("range_presets", "ts", sinceIso, "ts.asc,id.asc");
  }
  async pushSettings(row: SettingsRow) {
    await this.rest("user_settings?on_conflict=user_id", { method: "POST", body: JSON.stringify([{ ...row, user_id: this.session.userId }]), prefer: "resolution=merge-duplicates,return=minimal" });
  }
  async pullSettings(): Promise<SettingsRow | null> {
    const rows: SettingsRow[] = await this.rest(`user_settings?select=data,updated&limit=1`);
    return rows[0] ?? null;
  }
}

/** build-time configuration (set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY); null = sync is not configured */
export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}
