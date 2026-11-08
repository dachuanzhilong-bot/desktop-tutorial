"use client";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_SOLUTION, SolutionStore } from "./loader";
import type { NodeSolution } from "./types";

interface Ctx {
  store: SolutionStore | null;
  error: string | null;
  retry: () => void;
}
const SolutionContext = createContext<Ctx>({ store: null, error: null, retry: () => {} });

export function SolutionProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<SolutionStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    SolutionStore.open(DEFAULT_SOLUTION)
      .then((s) => alive && setStore(s))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const value = useMemo(() => ({ store, error, retry }), [store, error, retry]);
  return <SolutionContext.Provider value={value}>{children}</SolutionContext.Provider>;
}

export const useSolutionStore = () => useContext(SolutionContext);

/** loads (and caches) the per-hand data of one decision node */
export function useNodeSolution(nodeId: number | null) {
  const { store } = useSolutionStore();
  const [sol, setSol] = useState<NodeSolution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!store || nodeId === null) return;
    let alive = true;
    setLoading(true);
    setError(null);
    store
      .node(nodeId)
      .then((s) => alive && (setSol(s), setLoading(false)))
      .catch((e) => alive && (setError(String(e?.message ?? e)), setLoading(false)));
    return () => {
      alive = false;
    };
  }, [store, nodeId]);
  return { sol: store && nodeId !== null && sol && sol.id === nodeId ? sol : null, loading, error };
}
