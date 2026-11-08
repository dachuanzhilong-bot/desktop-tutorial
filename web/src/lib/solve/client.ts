import { buildConfig, solverRanges } from "./config";
import type { SolveInput } from "./config";

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

export interface RunResult {
  iterations: number;
  exploit: number;
  cancelled: boolean;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: Progress) => void };

/** Promise API around /solver-worker.js (the Rust solver compiled to WebAssembly). */
export class SolverClient {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();
  private handle = -1;
  nodes = 0;

  constructor(url = "/solver-worker.js") {
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      const p = this.pending.get(m.req);
      if (!p) return;
      if (m.type === "progress") return p.onProgress?.({ done: m.done, total: m.total, exploit: m.exploit });
      this.pending.delete(m.req);
      if (m.type === "error") p.reject(new Error(m.message));
      else p.resolve(m);
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "worker error"));
      this.pending.clear();
    };
  }

  private call<T = unknown>(msg: Record<string, unknown>, transfer: Transferable[] = [], onProgress?: Pending["onProgress"]): Promise<T> {
    const req = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.worker.postMessage({ req, ...msg }, transfer);
    });
  }

  init() {
    return this.call({ type: "init" });
  }

  /** build the game tree; replaces a previous one */
  async create(input: SolveInput): Promise<number> {
    if (this.handle >= 0) await this.destroy();
    const [r0, r1] = solverRanges(input.ranges, input.board);
    const m = await this.call<{ handle: number; nodes: number }>({
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
    return this.call<RunResult>(
      { type: "run", handle: this.handle, iterations: o.iterations, chunk: o.chunk ?? 20, restartAt: o.restartAt ?? 0, target: o.target ?? 0, checkEvery: o.checkEvery ?? 60 },
      [],
      o.onProgress && ((p) => o.onProgress!({ ...p, elapsed: performance.now() - t0 })),
    );
  }

  /** stop a running `run` after its current chunk (the run still resolves, with cancelled = true) */
  cancel() {
    this.worker.postMessage({ type: "cancel" });
  }

  async exploit(): Promise<number> {
    return (await this.call<{ exploit: number }>({ type: "exploit", handle: this.handle })).exploit;
  }

  async export(minReach = 0.004): Promise<Exported> {
    const m = await this.call<Exported>({ type: "export", handle: this.handle, minReach });
    return { bytes: m.bytes, map: m.map, exploit: m.exploit };
  }

  /** strategy: actions x 1326, each hand's column sums to 1 */
  async lock(node: number, strategy: Float32Array): Promise<boolean> {
    return (await this.call<{ ok: boolean }>({ type: "lock", handle: this.handle, node, strategy })).ok;
  }

  unlock(node: number) {
    return this.call({ type: "unlock", handle: this.handle, node });
  }

  async destroy() {
    if (this.handle >= 0) await this.call({ type: "destroy", handle: this.handle });
    this.handle = -1;
  }

  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("terminated"));
    this.pending.clear();
  }
}
