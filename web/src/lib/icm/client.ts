import { decodeIcm, IcmInput, IcmSolution, toConfig } from "./model";
import { withBase } from "../util/base";
import { SolverRpc } from "../solve/client";

export interface IcmProgress {
  done: number;
  total: number;
  /** % of the prize pool, -1 when not measured yet */
  exploit: number;
}

/** Promise API for the ICM push/fold solver, in the solver worker (the same WebAssembly module as Solve). */
export class IcmClient {
  private rpc: SolverRpc;
  private ready = false;

  constructor(worker?: Worker) {
    this.rpc = new SolverRpc(worker);
  }

  private async init() {
    if (this.ready) return;
    const res = await fetch(withBase("/data/equity169.bin"));
    if (!res.ok) throw new Error(`equity table ${res.status}`);
    const buf = await res.arrayBuffer();
    await this.rpc.call({ type: "icmInit", eq: new Uint16Array(buf) });
    this.ready = true;
  }

  /** solve and return every decision of the table; `onProgress` is called while it runs */
  async solve(input: IcmInput, opts: { iterations: number; target?: number; onProgress?: (p: IcmProgress) => void }): Promise<{ solution: IcmSolution; exploit: number; iterations: number; cancelled: boolean }> {
    await this.init();
    const { handle } = await this.rpc.call({ type: "icmCreate", cfg: toConfig(input) });
    try {
      const run = await this.rpc.call(
        { type: "icmRun", handle, iterations: opts.iterations, chunk: 25, restartAt: Math.floor(opts.iterations / 2), target: opts.target ?? 0, checkEvery: 200 },
        [],
        opts.onProgress,
      );
      const exp = await this.rpc.call({ type: "icmExport", handle });
      return { solution: decodeIcm(exp.data), exploit: exp.exploit, iterations: run.iterations, cancelled: run.cancelled };
    } finally {
      await this.rpc.call({ type: "icmDestroy", handle }).catch(() => {});
    }
  }

  cancel() {
    this.rpc.cancel();
  }

  terminate() {
    this.rpc.terminate();
  }
}
