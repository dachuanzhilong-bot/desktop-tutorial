"use client";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { UPDATED_KEY, useSettings } from "@/lib/settings";
import { getRepo } from "@/lib/storage/idb";
import { loadState, syncOnce } from "@/lib/sync/engine";
import type { SyncReport } from "@/lib/sync/engine";
import { AuthError, SupabaseAuth, SupabaseBackend, supabaseConfig } from "@/lib/sync/supabase";

type Status = "idle" | "syncing" | "error";

interface Ctx {
  configured: boolean;
  email: string | null;
  status: Status;
  lastSync: number;
  report: SyncReport | null;
  error: string | null;
  sendCode: (email: string) => Promise<void>;
  verify: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<Ctx | null>(null);

const AUTO_MS = 5 * 60_000;
const MAX_BACKOFF = 15 * 60_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const cfg = useMemo(() => supabaseConfig(), []);
  const auth = useMemo(() => (cfg ? new SupabaseAuth(cfg) : null), [cfg]);
  const { settings, applyRemote, ready } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const applyRef = useRef(applyRemote);
  applyRef.current = applyRemote;

  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [lastSync, setLastSync] = useState(0);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSyncRef = useRef(0);
  lastSyncRef.current = lastSync;
  const busy = useRef(false);
  const backoff = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncNow = useCallback(async () => {
    if (!cfg || !auth || busy.current) return;
    busy.current = true;
    setStatus("syncing");
    try {
      const session = await auth.session();
      if (!session) {
        setEmail(null);
        setStatus("idle");
        return;
      }
      const backend = new SupabaseBackend(cfg, session);
      const rep = await syncOnce(getRepo(), backend, session.userId, {
        get: () => ({ data: { ...settingsRef.current }, updated: Number(localStorage.getItem(UPDATED_KEY) ?? 0) || 0 }),
        apply: (data, updated) => applyRef.current(data, updated),
      });
      setReport(rep);
      setLastSync(Date.now());
      setError(null);
      setStatus("idle");
      backoff.current = 0;
    } catch (e) {
      if (e instanceof AuthError) {
        setEmail(null);
        setError("auth");
      } else setError(String((e as Error)?.message ?? e));
      setStatus("error");
      backoff.current = Math.min(MAX_BACKOFF, backoff.current ? backoff.current * 2 : 30_000);
    } finally {
      busy.current = false;
    }
  }, [cfg, auth]);

  // restore the session and the last sync time
  useEffect(() => {
    if (!ready || !auth) return;
    const s = auth.stored();
    if (!s) return;
    setEmail(s.email);
    getRepo()
      .getMeta<{ lastSync: number }>(`sync.state.${s.userId}`)
      .then((st) => st && setLastSync(st.lastSync))
      .catch(() => {});
    void syncNow();
  }, [ready, auth, syncNow]);

  // keep syncing: periodically, when the app comes back to the foreground, and when the network returns
  useEffect(() => {
    if (!email) return;
    const tick = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        if (navigator.onLine && document.visibilityState === "visible") await syncNow();
        tick();
      }, Math.max(AUTO_MS, backoff.current));
    };
    tick();
    const onVisible = () => document.visibilityState === "visible" && Date.now() - lastSyncRef.current > 2 * 60_000 && void syncNow();
    const onOnline = () => void syncNow();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [email, syncNow]);
  const value = useMemo<Ctx>(
    () => ({
      configured: !!cfg,
      email,
      status,
      lastSync,
      report,
      error,
      sendCode: async (addr) => {
        await auth!.sendCode(addr);
      },
      verify: async (addr, code) => {
        const s = await auth!.verifyCode(addr, code);
        setEmail(s.email);
        setError(null);
        const st = await loadState(getRepo(), s.userId);
        setLastSync(st.lastSync);
        void syncNow();
      },
      signOut: async () => {
        await auth?.signOut();
        setEmail(null);
        setReport(null);
        setError(null);
        setStatus("idle");
      },
      syncNow,
    }),
    [cfg, auth, email, status, lastSync, report, error, syncNow],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): Ctx {
  const c = useContext(SyncContext);
  if (!c) throw new Error("SyncProvider missing");
  return c;
}
