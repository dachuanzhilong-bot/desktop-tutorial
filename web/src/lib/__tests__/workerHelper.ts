import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import type { ProgressMessage, ReplyOf, SolverCall, SolverCalls, SolverReply, SolverRequest } from "../solve/protocol";

export const PUBLIC = path.resolve(__dirname, "../../../public");

/** a reply, with the progress events that came before it */
export type WorkerReply<K extends SolverCall> = ReplyOf<K> & { progress: ProgressMessage[] };

/** the worker scope the worker file sees: what it uses of a DedicatedWorkerGlobalScope */
interface FakeScope {
  fetch: (url: string) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
  postMessage: (m: SolverReply) => void;
  onmessage?: (e: { data: SolverRequest }) => void;
}

// one worker file is evaluated at a time: `self` and the base path are read when it is imported
let loading: Promise<unknown> = Promise.resolve();

const wasmResponse = () => {
  const wasm = readFileSync(path.join(PUBLIC, "wasm/tessera_solver.wasm"));
  return { arrayBuffer: async () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer };
};

/** evaluates a fresh copy of the worker file with `scope` as its `self`, built for the base path `base` */
function load(scope: FakeScope, base: string): Promise<unknown> {
  return (loading = loading.then(async () => {
    vi.resetModules();
    vi.stubGlobal("self", scope);
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", base);
    try {
      await import("../../workers/solver.worker");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  }));
}

/**
 * the real worker file behind a Worker-shaped object, for SolverClient / IcmClient. Messages are delivered
 * asynchronously, as between threads (but not copied).
 */
export async function connectWorker(base = ""): Promise<Worker> {
  const worker = {
    onmessage: null as ((e: { data: SolverReply }) => void) | null,
    onerror: null as unknown,
    postMessage: (m: SolverRequest) => void Promise.resolve().then(() => scope.onmessage!({ data: m })),
    terminate: () => {},
  };
  const scope: FakeScope = {
    fetch: async () => wasmResponse(),
    postMessage: (m) => void Promise.resolve().then(() => worker.onmessage?.({ data: m })),
  };
  await load(scope, base);
  return worker as unknown as Worker;
}

/**
 * runs the real src/workers/solver.worker.ts (a fresh copy per call), with the real .wasm.
 * `base` is the sub-path the app is built for ("" = the root); `fetched` collects the URLs the worker asks for.
 */
export function startWorker(base = "", fetched: string[] = []) {
  const waiting = new Map<number, { resolve: (m: SolverReply & { progress: ProgressMessage[] }) => void; reject: (e: Error) => void; progress: ProgressMessage[] }>();
  const scope: FakeScope = {
    fetch: async (url) => (fetched.push(url), wasmResponse()),
    postMessage: (m) => {
      const w = waiting.get(m.req);
      if (!w) return;
      if (m.type === "progress") w.progress.push(m);
      else {
        waiting.delete(m.req);
        if (m.type === "error") w.reject(new Error(m.message));
        else w.resolve({ ...m, progress: w.progress });
      }
    },
  };
  const ready = load(scope, base);
  let req = 1;
  return async <K extends SolverCall>(msg: { type: K } & SolverCalls[K]["args"]): Promise<WorkerReply<K>> => {
    await ready;
    return new Promise((resolve, reject) => {
      const r = req++;
      waiting.set(r, { resolve: resolve as (m: SolverReply & { progress: ProgressMessage[] }) => void, reject, progress: [] });
      scope.onmessage!({ data: { req: r, ...msg } as SolverRequest });
    });
  };
}
