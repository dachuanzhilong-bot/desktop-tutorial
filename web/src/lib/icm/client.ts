import { decodeIcm, IcmInput, IcmSolution, toConfig } from "./model";

export interface IcmProgress {
  done: number;
  total: number;
  /** % of the prize pool, -1 when not measured yet */
  exploit: number;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: IcmProgress) => void };

/** Promise API for the ICM push/fold solver running in /solver-worker.js (the same WebAssembly module as Solve). */
export class IcmClient {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();
  private ready = false;

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

  private async init() {
    if (this.ready) return;
    const res = await fetch("/data/equity169.bin");
    if (!res.ok) throw new Error(`equity table ${res.status}`);
    const buf = await res.arrayBuffer();
    await this.call({ type: "icmInit", eq: new Uint16Array(buf) });
    this.ready = true;
  }

  /** solve and return every decision of the table; `onProgress` is called while it runs */
  async solve(input: IcmInput, opts: { iterations: number; target?: number; onProgress?: (p: IcmProgress) => void }): Promise<{ solution: IcmSolution; exploit: number; iterations: number; cancelled: boolean }> {
    await this.init();
    const { handle } = await this.call<{ handle: number }>({ type: "icmCreate", cfg: toConfig(input) });
    try {
      const run = await this.call<{ iterations: number; exploit: number; cancelled: boolean }>(
        { type: "icmRun", handle, iterations: opts.iterations, chunk: 25, restartAt: Math.floor(opts.iterations / 2), target: opts.target ?? 0, checkEvery: 200 },
        [],
        opts.onProgress,
      );
      const exp = await this.call<{ data: Float32Array; exploit: number }>({ type: "icmExport", handle });
      return { solution: decodeIcm(exp.data), exploit: exp.exploit, iterations: run.iterations, cancelled: run.cancelled };
    } finally {
      await this.call({ type: "icmDestroy", handle }).catch(() => {});
    }
  }

  cancel() {
    this.worker.postMessage({ type: "cancel" });
  }

  terminate() {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error("terminated"));
    this.pending.clear();
  }
}
