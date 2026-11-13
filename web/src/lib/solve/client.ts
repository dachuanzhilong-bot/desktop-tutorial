import { buildConfig, solverRanges } from "./config";
import type { SolveInput } from "./config";
import { REPLY } from "./protocol";
import type { CancelMessage, RunDone, ReplyOf, RequestOf, SolverCall, SolverCalls, SolverReply } from "./protocol";

export interface Progress {
  done: number;
  total: number;
  /** exploitability in % of the starting pot, -1 when not measured yet */
  exploit: number;
  /** ms since this run started (for the remaining-time estimate) */
  elapsed?: number;
}

export interface Exported {
  bytes: Uint8Array;
  /** exported node id -> solver tree node id (needed for node-locking) */
  map: Uint32Array;
  exploit: number;
}

export interface RunOptions {
  iterations: number;
  /** drop the strategy sums at this iteration (restart averaging); 0 = never */
  restartAt?: number;
  /** stop early once the exploitability (% of pot) falls below this */
  target?: number;
  chunk?: number;
  checkEvery?: number;
  onProgress?: (p: Progress) => void;
}

export type RunResult = RunDone;

interface Pending {
  expect: string;
  resolve: (v: SolverReply) => void;
  reject: (e: Error) => void;
  onProgress?: (p: Progress) => void;
}

/** the solver worker (src/workers/solver.worker.ts), bundled by Next like the flop worker */
export function newSolverWorker(): Worker {
  return new Worker(new URL("../../workers/solver.worker.ts", import.meta.url));
}

/** requests and replies of one solver worker (protocol.ts), as promises; shared by Solve and ICM */
export class SolverRpc {
  private next = 1;
  private pending = new Map<number, Pending>();

  constructor(private worker: Worker = newSolverWorker()) {
    this.worker.onmessage = (e: MessageEvent<SolverReply>) => {
      const m = e.data;
      const p = this.pending.get(m.req);
      if (!p) return;
      if (m.type === "progress") return p.onProgress?.({ done: m.done, total: m.total, exploit: m.exploit });
      this.pending.delete(m.req);
      if (m.type === "error") p.reject(new Error(m.message));
      else if (m.type !== p.expect) p.reject(new Error(`unexpected reply ${m.type} (expected ${p.expect})`));
      else p.resolve(m);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "worker error"));
      this.pending.clear();
    };
  }

  call<K extends SolverCall>(msg: { type: K } & SolverCalls[K]["args"], transfer: Transferable[] = [], onProgress?: (p: Progress) => void): Promise<ReplyOf<K>> {
    const req = this.next++;
    return new Promise<ReplyOf<K>>((resolve, reject) => {
      this.pending.set(req, { expect: REPLY[msg.type], resolve: resolve as (v: SolverReply) => void, reject, onProgress });
      this.worker.postMessage({ req, ...msg } as RequestOf<K>, transfer);
    });
  }

  /** stop a running `run`/`icmRun` after its current chunk (the run still replies, with cancelled = true) */
  cancel() {
    this.worker.postMessage({ type: "cancel" } satisfies CancelMessage);
  }

  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("terminated"));
    this.pending.clear();
  }
}

/** Promise API around the solver worker (the Rust solver compiled to WebAssembly). */
export class SolverClient {
  private rpc: SolverRpc;
  private handle = -1;
  nodes = 0;

  constructor(worker?: Worker) {
    this.rpc = new SolverRpc(worker);
  }

  init() {
    return this.rpc.call({ type: "init" });
  }

  /** build the game tree; replaces a previous one */
  async create(input: SolveInput): Promise<number> {
    if (this.handle >= 0) await this.destroy();
    const [r0, r1] = solverRanges(input.ranges, input.board);
    const m = await this.rpc.call({
      type: "create",
      cfg: buildConfig(input.cfg),
      board: input.board,
      r0,
      r1,
    });
    this.handle = m.handle;
    this.nodes = m.nodes;
    return m.nodes;
  }

  run(o: RunOptions): Promise<RunResult> {
    const t0 = performance.now();
    return this.rpc.call(
      { type: "run", handle: this.handle, iterations: o.iterations, chunk: o.chunk ?? 20, restartAt: o.restartAt ?? 0, target: o.target ?? 0, checkEvery: o.checkEvery ?? 60 },
      [],
      o.onProgress && ((p) => o.onProgress!({ ...p, elapsed: performance.now() - t0 })),
    );
  }

  /** stop a running `run` after its current chunk (the run still resolves, with cancelled = true) */
  cancel() {
    this.rpc.cancel();
  }

  async exploit(): Promise<number> {
    return (await this.rpc.call({ type: "exploit", handle: this.handle })).exploit;
  }

  async export(minReach = 0.004): Promise<Exported> {
    const m = await this.rpc.call({ type: "export", handle: this.handle, minReach });
    return { bytes: m.bytes, map: m.map, exploit: m.exploit };
  }

  /** strategy: actions x 1326, each hand's column sums to 1 */
  async lock(node: number, strategy: Float32Array): Promise<boolean> {
    return (await this.rpc.call({ type: "lock", handle: this.handle, node, strategy })).ok;
  }

  unlock(node: number) {
    return this.rpc.call({ type: "unlock", handle: this.handle, node });
  }

  async destroy() {
    if (this.handle >= 0) await this.rpc.call({ type: "destroy", handle: this.handle });
    this.handle = -1;
  }

  terminate() {
    this.rpc.terminate();
  }
}
