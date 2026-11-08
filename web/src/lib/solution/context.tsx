"use client";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../settings";
import { DEFAULT_DEPTH, DEPTHS, solutionId, SolutionStore } from "./loader";
import type { NodeSolution } from "./types";

interface Ctx {
  /** the solution of the selected stack depth (the previous one stays until the next has loaded) */
  store: SolutionStore | null;
  error: string | null;
  retry: () => void;
  /** depth the user selected (store.manifest.stack may lag behind while it loads) */
  depth: number;
  loading: boolean;
  setDepth: (d: number) => void;
  /** any depth's solution (cached) */
  getStore: (depth: number) => Promise<SolutionStore>;
}
const SolutionContext = createContext<Ctx>({ store: null, error: null, retry: () => {}, depth: DEFAULT_DEPTH, loading: false, setDepth: () => {}, getStore: () => Promise.reject(new Error("no provider")) });

export function SolutionProvider({ children }: { children: ReactNode }) {
  const { settings, set, ready } = useSettings();
  const depth = (DEPTHS as readonly number[]).includes(settings.depth) ? settings.depth : DEFAULT_DEPTH;
  /** last solution that finished loading (kept on screen while another depth loads) */
  const [store, setStore] = useState<SolutionStore | null>(null);
  /** outcome of the latest request, tagged with the request it answers */
  const [outcome, setOutcome] = useState<{ key: string; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${depth}#${attempt}`;
  const cache = useRef(new Map<number, Promise<SolutionStore>>());

  const getStore = useCallback((d: number) => {
    let p = cache.current.get(d);
    if (!p) {
      p = SolutionStore.open(solutionId(d));
      p.catch(() => cache.current.delete(d));
      cache.current.set(d, p);
    }
    return p;
  }, []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    getStore(depth)
      .then((s) => {
        if (!alive) return;
        setStore(s);
        setOutcome({ key, error: null });
      })
      .catch((e) => alive && setOutcome({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [ready, depth, key, getStore]);
  // a new depth / retry makes the previous outcome stale: loading again, no error shown
  const current = outcome?.key === key ? outcome : null;
  const loading = !current;
  const error = current?.error ?? null;

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const setDepth = useCallback((d: number) => set({ depth: d }), [set]);
  const value = useMemo(() => ({ store, error, retry, depth, loading, setDepth, getStore }), [store, error, retry, depth, loading, setDepth, getStore]);
  return <SolutionContext.Provider value={value}>{children}</SolutionContext.Provider>;
}

export const useSolutionStore = () => useContext(SolutionContext);

/** loads (and caches) the per-hand data of one decision node */
export function useNodeSolution(nodeId: number | null) {
  const { store } = useSolutionStore();
  const key = store && nodeId !== null ? `${store.manifest.id}#${nodeId}` : null;
  const [res, setRes] = useState<{ key: string; data: NodeSolution | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!store || nodeId === null || !key) return;
    let alive = true;
    store
      .node(nodeId)
      .then((data) => alive && setRes({ key, data, error: null }))
      .catch((e) => alive && setRes({ key, data: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [store, nodeId, key]);
  // only the answer to the current request counts (switching node/depth shows "loading", never stale data)
  const cur = res && res.key === key ? res : null;
  return { sol: cur?.data ?? null, loading: !!key && !cur, error: cur?.error ?? null };
}
