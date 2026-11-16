"use client";
import { createContext, ReactNode, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "../settings";
import { NO_RAKE_KEY } from "./rake";
import { depthOf, rakeOf, solutionIdWithRake } from "./catalog";
import { DEFAULT_DEPTH, DEPTHS, SolutionStore } from "./loader";
import type { NodeSolution } from "./types";

interface Ctx {
  /** the solution of the selected stack depth (the previous one stays until the next has loaded) */
  store: SolutionStore | null;
  error: string | null;
  retry: () => void;
  /** depth the user selected (store.manifest.stack may lag behind while it loads) */
  depth: number;
  /** rake the user selected (`rakeKey`; it only counts where the depth has a solution with it, see `solutionId`) */
  rake: string;
  loading: boolean;
  setDepth: (d: number) => void;
  setRake: (rake: string) => void;
  /** select a solution by its id (its depth and rake), e.g. the one a list of questions was made from */
  setSolution: (id: string) => void;
  /** any depth's solution (cached); without `rake`, the solution without rake */
  getStore: (depth: number, rake?: string) => Promise<SolutionStore>;
}
const SolutionContext = createContext<Ctx>({
  store: null,
  error: null,
  retry: () => {},
  depth: DEFAULT_DEPTH,
  rake: NO_RAKE_KEY,
  loading: false,
  setDepth: () => {},
  setRake: () => {},
  setSolution: () => {},
  getStore: () => Promise.reject(new Error("no provider")),
});

export function SolutionProvider({ children }: { children: ReactNode }) {
  const { settings, set, ready } = useSettings();
  const depth = (DEPTHS as readonly number[]).includes(settings.depth) ? settings.depth : DEFAULT_DEPTH;
  /** last solution that finished loading (kept on screen while another depth loads) */
  const [store, setStore] = useState<SolutionStore | null>(null);
  /** outcome of the latest request, tagged with the request it answers */
  const [outcome, setOutcome] = useState<{ key: string; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const rake = settings.rake;
  const key = `${solutionIdWithRake(depth, rake)}#${attempt}`;
  /** by solution id */
  const cache = useRef(new Map<string, Promise<SolutionStore>>());

  const getStore = useCallback((d: number, r?: string) => {
    const id = solutionIdWithRake(d, r ?? NO_RAKE_KEY);
    let p = cache.current.get(id);
    if (!p) {
      // the first decision (where Study and most practice start) is decoded before the store is handed out,
      // so screens render once with data instead of once empty and again when it arrives
      p = SolutionStore.open(id).then(async (s) => {
        await s.node(0).catch(() => {});
        return s;
      });
      p.catch(() => cache.current.delete(id));
      cache.current.set(id, p);
    }
    return p;
  }, []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    getStore(depth, rake)
      .then((s) => {
        if (!alive) return;
        // a non-urgent update: React renders the (large) screens in short slices, so input stays responsive
        startTransition(() => {
          setStore(s);
          setOutcome({ key, error: null });
        });
      })
      .catch((e) => alive && setOutcome({ key, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [ready, depth, rake, key, getStore]);
  // a new depth / rake / retry makes the previous outcome stale: loading again, no error shown
  const current = outcome?.key === key ? outcome : null;
  const loading = !current;
  const error = current?.error ?? null;

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const setDepth = useCallback((d: number) => set({ depth: d }), [set]);
  const setRake = useCallback((r: string) => set({ rake: r }), [set]);
  const setSolution = useCallback((id: string) => set({ depth: depthOf(id), rake: rakeOf(id) }), [set]);
  const value = useMemo(
    () => ({ store, error, retry, depth, rake, loading, setDepth, setRake, setSolution, getStore }),
    [store, error, retry, depth, rake, loading, setDepth, setRake, setSolution, getStore],
  );
  return <SolutionContext.Provider value={value}>{children}</SolutionContext.Provider>;
}

export const useSolutionStore = () => useContext(SolutionContext);

/** loads (and caches) the per-hand data of one decision node */
export function useNodeSolution(nodeId: number | null) {
  const { store } = useSolutionStore();
  const key = store && nodeId !== null ? `${store.manifest.id}#${nodeId}` : null;
  const [res, setRes] = useState<{ key: string; data: NodeSolution | null; error: string | null } | null>(null);
  const cached = store && nodeId !== null ? store.peek(nodeId) : null;
  useEffect(() => {
    if (!store || nodeId === null || !key || store.peek(nodeId)) return;
    let alive = true;
    store
      .node(nodeId)
      .then((data) => alive && startTransition(() => setRes({ key, data, error: null })))
      .catch((e) => alive && setRes({ key, data: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [store, nodeId, key]);
  // only the answer to the current request counts (switching node/depth shows "loading", never stale data)
  const cur = res && res.key === key ? res : null;
  return { sol: cached ?? cur?.data ?? null, loading: !!key && !cached && !cur, error: cached ? null : (cur?.error ?? null) };
}
