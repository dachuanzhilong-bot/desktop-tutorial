/**
 * The app's river layer (lib/postflop/river.ts): the solver worker of the Solve screen (lib/solve/client.ts, the Rust
 * solver compiled to WebAssembly, public/wasm/tessera_solver.wasm) and the IndexedDB store (riverStore.ts). One layer
 * for the whole app, so Study, the practice drill and the records share what has been solved.
 */
import { SolverRpc } from "../solve/client";
import { RiverLayer } from "./river";
import type { RiverBackend, RiverJob } from "./river";
import { idbRiverStore } from "./riverStore";

/** chunk of the worker's run: divides RIVER_ITERATIONS / 2, so the average restarts exactly at half (as the solver's `Plan`) */
const CHUNK = 150;

/**
 * A river backend on one solver connection (`rpc`): one river at a time (the module runs one solve at a time), the tree
 * destroyed after its export. `rpc` is made on the first solve.
 */
export function rpcRiverBackend(rpc: () => SolverRpc): RiverBackend {
  let conn: SolverRpc | null = null;
  let ready: Promise<unknown> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const start = () => {
    conn ??= rpc();
    ready ??= conn.call({ type: "init" });
    ready.catch(() => (ready = null));
    return conn;
  };
  const one = async (job: RiverJob, onProgress?: (done: number, total: number) => void) => {
    const c = start();
    await ready;
    const { handle } = await c.call({ type: "create", cfg: job.cfg, board: job.board, r0: job.r0, r1: job.r1 });
    try {
      // one exploitability measure at the end only (an export measures it as well)
      await c.call({ type: "run", handle, iterations: job.iterations, chunk: CHUNK, restartAt: job.restartAt, target: 0, checkEvery: job.iterations }, [], onProgress && ((p) => onProgress(p.done, p.total)));
      // every line of the river tree (min_reach 0): a line's presence does not depend on the solve
      return (await c.call({ type: "export", handle, minReach: 0 })).bytes;
    } finally {
      await c.call({ type: "destroy", handle }).catch(() => {});
    }
  };
  return {
    // the worker and its module, started before the first river is asked for
    warm() {
      start();
    },
    solve(job, onProgress) {
      const p = queue.then(() => one(job, onProgress));
      queue = p.catch(() => {});
      return p;
    },
  };
}

let layer: RiverLayer | null = null;

/** the app's layer (made on first use, in the browser) */
export function riverLayer(): RiverLayer {
  return (layer ??= new RiverLayer(
    rpcRiverBackend(() => new SolverRpc()),
    idbRiverStore(),
  ));
}
