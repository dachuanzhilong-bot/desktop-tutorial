/**
 * The messages between the screens (SolverClient, IcmClient) and the solver worker (src/workers/solver.worker.ts),
 * which runs the Rust solver compiled to WebAssembly (public/wasm/tessera_solver.wasm). Both sides import these types.
 *
 * A request `{ req, type, ... }` gets exactly one reply with the same `req`: the type in REPLY, or `error`.
 * `run` and `icmRun` also send `progress` events while they run. `cancel` has no reply: it stops the running
 * `run`/`icmRun` after its current chunk, and that run then replies with `cancelled: true`.
 */

/** where the worker finds the module, relative to the app's base path */
export const SOLVER_WASM = "/wasm/tessera_solver.wasm";

/** options shared by `run` and `icmRun` */
export interface RunParams {
  handle: number;
  iterations: number;
  /** iterations between two returns to the event loop (so `cancel` is heard) */
  chunk?: number;
  /** drop the strategy sums at this iteration (restart averaging); 0 = never */
  restartAt?: number;
  /** stop early once the exploitability falls below this; 0 = never */
  target?: number;
  /** iterations between two exploitability measurements (they cost more than an iteration) */
  checkEvery?: number;
}

export interface RunDone {
  iterations: number;
  /** % of the starting pot (Solve) or of the prize pool (ICM); -1 when not measured */
  exploit: number;
  cancelled: boolean;
}

/** every request, with what it sends and what comes back */
export interface SolverCalls {
  /** load the module */
  init: { args: Record<never, never>; reply: { type: "ready" } };
  /** build the game tree: cfg from buildConfig, board as card numbers, r0/r1 the 1326 combo weights of each player */
  create: { args: { cfg: number[]; board: number[]; r0: Float32Array; r1: Float32Array }; reply: { type: "created"; handle: number; nodes: number } };
  run: { args: RunParams; reply: { type: "run-done" } & RunDone };
  exploit: { args: { handle: number }; reply: { type: "exploit-done"; exploit: number } };
  /** the solution as a TSP1 file, and exported node id -> solver tree node id (needed for node-locking) */
  export: { args: { handle: number; minReach: number }; reply: { type: "export-done"; bytes: Uint8Array; map: Uint32Array; exploit: number } };
  /** strategy: actions x 1326, each hand's column sums to 1 */
  lock: { args: { handle: number; node: number; strategy: Float32Array }; reply: { type: "lock-done"; ok: boolean } };
  unlock: { args: { handle: number; node: number }; reply: { type: "unlock-done" } };
  destroy: { args: { handle: number }; reply: { type: "destroy-done" } };
  /** the 169x169 preflop equity table (public/data/equity169.bin), once */
  icmInit: { args: { eq: Uint16Array }; reply: { type: "icm-ready" } };
  icmCreate: { args: { cfg: number[] }; reply: { type: "icm-created"; handle: number } };
  icmRun: { args: RunParams; reply: { type: "icm-run-done" } & RunDone };
  icmExport: { args: { handle: number }; reply: { type: "icm-export-done"; data: Float32Array; exploit: number } };
  icmDestroy: { args: { handle: number }; reply: { type: "icm-destroy-done" } };
}

export type SolverCall = keyof SolverCalls;

/** the reply type of each request: the client rejects a reply of another type */
export const REPLY: { [K in SolverCall]: SolverCalls[K]["reply"]["type"] } = {
  init: "ready",
  create: "created",
  run: "run-done",
  exploit: "exploit-done",
  export: "export-done",
  lock: "lock-done",
  unlock: "unlock-done",
  destroy: "destroy-done",
  icmInit: "icm-ready",
  icmCreate: "icm-created",
  icmRun: "icm-run-done",
  icmExport: "icm-export-done",
  icmDestroy: "icm-destroy-done",
};

export type RequestOf<K extends SolverCall> = { req: number; type: K } & SolverCalls[K]["args"];
export type ReplyOf<K extends SolverCall> = { req: number } & SolverCalls[K]["reply"];

export interface CancelMessage {
  type: "cancel";
}
export type SolverRequest = { [K in SolverCall]: RequestOf<K> }[SolverCall] | CancelMessage;

export interface ProgressMessage {
  req: number;
  type: "progress";
  done: number;
  total: number;
  exploit: number;
}
export interface ErrorMessage {
  req: number;
  type: "error";
  message: string;
}
export type SolverReply = { [K in SolverCall]: ReplyOf<K> }[SolverCall] | ProgressMessage | ErrorMessage;
