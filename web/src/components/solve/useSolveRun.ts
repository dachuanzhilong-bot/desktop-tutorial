"use client";
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { decodeFlop } from "@/lib/postflop/decode";
import { useSettings } from "@/lib/settings";
import { SolverClient } from "@/lib/solve/client";
import type { Exported, Progress, RunResult } from "@/lib/solve/client";
import type { SolveInput } from "@/lib/solve/config";
import { INITIAL_RUN, runReducer } from "@/lib/solve/run";
import type { SolveResult } from "@/lib/solve/run";

const toResult = (exp: Exported, r: RunResult): SolveResult => ({ flop: decodeFlop(exp.bytes), map: exp.map, exploit: exp.exploit, iterations: r.iterations, bytes: exp.bytes, stopped: r.cancelled });

const noSubscribe = () => () => {};

/** runs the solver worker for the Solve screen (lib/solve/run.ts): solve, cancel, node locks */
export function useSolveRun() {
  const { t } = useSettings();
  const [run, dispatch] = useReducer(runReducer, INITIAL_RUN);
  const clientRef = useRef<SolverClient | null>(null);
  // the server render assumes WebAssembly; the browser tells
  const wasmOk = useSyncExternalStore(noSubscribe, () => typeof WebAssembly === "object", () => true);

  useEffect(() => () => clientRef.current?.terminate(), []);

  const getClient = () => (clientRef.current ??= new SolverClient());
  const onProgress = (progress: Progress) => dispatch({ type: "progress", progress });
  const failure = (e: unknown) => t("solve.error", { msg: e instanceof Error ? e.message : String(e) });

  const start = async (input: SolveInput, iterations: number, target: number) => {
    dispatch({ type: "start" });
    try {
      const c = getClient();
      await c.init();
      dispatch({ type: "built", nodes: await c.create(input) });
      const r = await c.run({ iterations, restartAt: Math.floor(iterations * 0.5), target, onProgress });
      dispatch({ type: "finished", result: toResult(await c.export(0.004), r) });
    } catch (e) {
      dispatch({ type: "failed", error: failure(e) });
    }
  };

  const stop = () => clientRef.current?.cancel();

  /** lock (strategy) or unlock (null) an exported node of the result, then run `iters` more iterations */
  const relock = async (exportedNode: number, seat: string, strategy: Float32Array | null, iters: number) => {
    if (!run.result) return;
    const c = getClient();
    const tree = run.result.map[exportedNode];
    dispatch({ type: "lockStart" });
    let error: string | undefined;
    try {
      if (strategy) {
        if (!(await c.lock(tree, strategy))) throw new Error("lock rejected");
      } else await c.unlock(tree);
      dispatch({ type: "lock", tree, seat: strategy ? seat : null });
      const r = await c.run({ iterations: iters, restartAt: Math.floor(iters * 0.5), onProgress });
      const exp = await c.export(0.004);
      dispatch({ type: "relocked", result: toResult(exp, r), keepNode: exp.map.indexOf(tree) });
    } catch (e) {
      error = failure(e);
    }
    dispatch({ type: "lockEnd", error });
  };

  const view = useCallback((node: number) => dispatch({ type: "view", node }), []);
  const markSaved = useCallback((id: string, note: string) => dispatch({ type: "saved", id, note }), []);
  const reset = useCallback((savedId: string) => dispatch({ type: "reset", savedId }), []);

  return { run, wasmOk, start, stop, relock, view, markSaved, reset };
}
