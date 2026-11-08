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
  const [store, setStore] = useState<SolutionStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
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
    setError(null);
    setLoading(true);
    getStore(depth)
      .then((s) => alive && (setStore(s), setLoading(false)))
      .catch((e) => alive && (setError(String(e?.message ?? e)), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [ready, depth, attempt, getStore]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const setDepth = useCallback((d: number) => set({ depth: d }), [set]);
  const value = useMemo(() => ({ store, error, retry, depth, loading, setDepth, getStore }), [store, error, retry, depth, loading, setDepth, getStore]);
  return <SolutionContext.Provider value={value}>{children}</SolutionContext.Provider>;
}

export const useSolutionStore = () => useContext(SolutionContext);

/** loads (and caches) the per-hand data of one decision node */
export function useNodeSolution(nodeId: number | null) {
  const { store } = useSolutionStore();
  const [sol, setSol] = useState<{ solution: string; data: NodeSolution } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!store || nodeId === null) return;
    let alive = true;
    setLoading(true);
    setError(null);
    store
      .node(nodeId)
      .then((s) => alive && (setSol({ solution: store.manifest.id, data: s }), setLoading(false)))
      .catch((e) => alive && (setError(String(e?.message ?? e)), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [store, nodeId]);
  const ok = store && nodeId !== null && sol && sol.solution === store.manifest.id && sol.data.id === nodeId;
  return { sol: ok ? sol.data : null, loading, error };
}
