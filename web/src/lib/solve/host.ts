/**
 * The worker side of the solver protocol (protocol.ts): turns requests into calls of the WebAssembly module's C ABI
 * (solver/src/ffi.rs) and posts the replies. src/workers/solver.worker.ts wires it to the worker's `self`; the tests
 * run the same worker file with the real .wasm.
 */
import type { ProgressMessage, RequestOf, RunParams, SolverCall, SolverCalls, SolverReply, SolverRequest } from "./protocol";

/** the C ABI of tessera_solver.wasm (pointers and handles are numbers) */
export interface SolverExports {
  memory: WebAssembly.Memory;
  tsr_alloc(len: number): number;
  tsr_free(ptr: number, len: number): void;
  tsr_alloc_f32(len: number): number;
  tsr_free_f32(ptr: number, len: number): void;
  tsr_create(cfg: number, cfgLen: number, board: number, boardLen: number, r0: number, r1: number): number;
  tsr_node_count(h: number): number;
  tsr_run(h: number, n: number): void;
  tsr_iterations(h: number): number;
  tsr_reset_average(h: number): void;
  tsr_exploit_pct(h: number): number;
  tsr_export(h: number, minReach: number): number;
  tsr_out_ptr(h: number): number;
  tsr_map_ptr(h: number): number;
  tsr_map_len(h: number): number;
  tsr_lock(h: number, node: number, strategy: number, len: number): number;
  tsr_unlock(h: number, node: number): void;
  tsr_destroy(h: number): void;
  tsr_icm_set_equity(ptr: number): void;
  tsr_icm_create(cfg: number, cfgLen: number): number;
  tsr_icm_run(h: number, n: number): void;
  tsr_icm_reset_average(h: number): void;
  tsr_icm_exploit_pct(h: number): number;
  tsr_icm_export(h: number): number;
  tsr_icm_out_ptr(h: number): number;
  tsr_icm_destroy(h: number): void;
}

export type Post = (m: SolverReply, transfer?: Transferable[]) => void;

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * The message handler of one worker. `load` fetches and instantiates the module (called once, on the first request);
 * `post` sends a message back to the page.
 */
export function createSolverHost(load: () => Promise<SolverExports>, post: Post): (m: SolverRequest) => Promise<void> {
  let ex: SolverExports | null = null;
  let cancelled = false;

  const f32 = (e: SolverExports, ptr: number, n: number) => new Float32Array(e.memory.buffer, ptr, n);
  const put32 = (e: SolverExports, arr: ArrayLike<number>) => {
    const p = e.tsr_alloc_f32(arr.length);
    f32(e, p, arr.length).set(arr);
    return p;
  };

  /** the iteration loop of `run` and `icmRun`: chunks, restart averaging, early stop at the target, cancel */
  async function iterate(m: RunParams & { req: number }, step: (n: number) => void, reset: () => void, measure: () => number, defaultCheck: number, pastRestart: (done: number) => boolean) {
    cancelled = false;
    const chunk = Math.max(1, m.chunk || 25);
    let done = 0;
    let exploit = -1;
    const progress = (): ProgressMessage => ({ req: m.req, type: "progress", done, total: m.iterations, exploit });
    while (done < m.iterations && !cancelled) {
      const n = Math.min(chunk, m.iterations - done);
      step(n);
      done += n;
      if (m.restartAt && done - n < m.restartAt && done >= m.restartAt) reset();
      if (done === m.iterations || done % (m.checkEvery || defaultCheck) < chunk) {
        exploit = measure();
        if (m.target && exploit >= 0 && exploit < m.target && pastRestart(done)) {
          post(progress());
          break;
        }
      }
      post(progress());
      await tick();
    }
    return { done, exploit };
  }

  type Answer<K extends SolverCall> = SolverCalls[K]["reply"] | [SolverCalls[K]["reply"], Transferable[]];
  /** one function per request: returns the reply (with the buffers to transfer), or throws for an `error` reply */
  const handlers: { [K in SolverCall]: (m: RequestOf<K>, e: SolverExports) => Answer<K> | Promise<Answer<K>> } = {
    init: () => ({ type: "ready" }),
    create: (m, e) => {
      const cfg = put32(e, m.cfg);
      const board = e.tsr_alloc(m.board.length);
      new Uint8Array(e.memory.buffer, board, m.board.length).set(m.board);
      const r0 = put32(e, m.r0);
      const r1 = put32(e, m.r1);
      const handle = e.tsr_create(cfg, m.cfg.length, board, m.board.length, r0, r1);
      e.tsr_free_f32(cfg, m.cfg.length);
      e.tsr_free(board, m.board.length);
      e.tsr_free_f32(r0, 1326);
      e.tsr_free_f32(r1, 1326);
      if (handle < 0) throw new Error(`create failed (${handle})`);
      return { type: "created", handle, nodes: e.tsr_node_count(handle) };
    },
    run: async (m, e) => {
      const h = m.handle;
      const { exploit } = await iterate(m, (n) => e.tsr_run(h, n), () => e.tsr_reset_average(h), () => e.tsr_exploit_pct(h), 100, () => true);
      return { type: "run-done", iterations: e.tsr_iterations(h), exploit, cancelled };
    },
    exploit: (m, e) => ({ type: "exploit-done", exploit: e.tsr_exploit_pct(m.handle) }),
    export: (m, e) => {
      const exploit = e.tsr_exploit_pct(m.handle);
      const len = e.tsr_export(m.handle, m.minReach);
      const bytes = new Uint8Array(e.memory.buffer, e.tsr_out_ptr(m.handle), len).slice();
      const map = new Uint32Array(e.memory.buffer, e.tsr_map_ptr(m.handle), e.tsr_map_len(m.handle)).slice();
      return [{ type: "export-done", bytes, map, exploit }, [bytes.buffer, map.buffer]];
    },
    lock: (m, e) => {
      const p = put32(e, m.strategy);
      const code = e.tsr_lock(m.handle, m.node, p, m.strategy.length);
      e.tsr_free_f32(p, m.strategy.length);
      return { type: "lock-done", ok: code === 0 };
    },
    unlock: (m, e) => {
      e.tsr_unlock(m.handle, m.node);
      return { type: "unlock-done" };
    },
    destroy: (m, e) => {
      e.tsr_destroy(m.handle);
      return { type: "destroy-done" };
    },
    icmInit: (m, e) => {
      const words = Math.ceil(m.eq.byteLength / 4);
      const p = e.tsr_alloc_f32(words); // 4-byte aligned, so it is fine to read as u16
      new Uint8Array(e.memory.buffer, p, m.eq.byteLength).set(new Uint8Array(m.eq.buffer, m.eq.byteOffset, m.eq.byteLength));
      e.tsr_icm_set_equity(p);
      e.tsr_free_f32(p, words);
      return { type: "icm-ready" };
    },
    icmCreate: (m, e) => {
      const cfg = put32(e, m.cfg);
      const handle = e.tsr_icm_create(cfg, m.cfg.length);
      e.tsr_free_f32(cfg, m.cfg.length);
      if (handle < 0) throw new Error(handle === -2 ? "equity table not loaded" : "invalid ICM setup");
      return { type: "icm-created", handle };
    },
    icmRun: async (m, e) => {
      const h = m.handle;
      const { done } = await iterate(m, (n) => e.tsr_icm_run(h, n), () => e.tsr_icm_reset_average(h), () => e.tsr_icm_exploit_pct(h), 200, (d) => d > (m.restartAt || 0));
      return { type: "icm-run-done", iterations: done, exploit: e.tsr_icm_exploit_pct(h), cancelled };
    },
    icmExport: (m, e) => {
      const exploit = e.tsr_icm_exploit_pct(m.handle);
      const len = e.tsr_icm_export(m.handle);
      const data = new Float32Array(e.memory.buffer, e.tsr_icm_out_ptr(m.handle), len).slice();
      return [{ type: "icm-export-done", data, exploit }, [data.buffer]];
    },
    icmDestroy: (m, e) => {
      e.tsr_icm_destroy(m.handle);
      return { type: "icm-destroy-done" };
    },
  };

  return async (m) => {
    if (m.type === "cancel") {
      cancelled = true;
      return;
    }
    try {
      ex ??= await load();
      if (!Object.hasOwn(handlers, m.type)) throw new Error(`unknown request ${m.type}`);
      const handler = handlers[m.type] as (m: SolverRequest, e: SolverExports) => Answer<SolverCall> | Promise<Answer<SolverCall>>;
      const out = await handler(m, ex);
      const [reply, transfer] = Array.isArray(out) ? out : [out, []];
      post({ req: m.req, ...reply } as SolverReply, transfer);
    } catch (err) {
      post({ req: m.req, type: "error", message: String((err instanceof Error && err.message) || err) });
    }
  };
}
