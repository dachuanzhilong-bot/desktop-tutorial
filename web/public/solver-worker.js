/* Tessera solver worker: runs the Rust/WebAssembly postflop solver off the main thread.
 *
 * requests  { req, type, ... }  ->  one reply { req, type: "...done" | "error" } (and `progress` events for `run`)
 *   init                                  load the module
 *   create  { cfg:number[], board:number[], r0:Float32Array, r1:Float32Array }   -> { handle, nodes }
 *   run     { handle, iterations, chunk, restartAt, target? }                   -> { iterations, exploit }
 *   cancel                                 stop the running `run` after the current chunk
 *   exploit { handle }                                                           -> { exploit }
 *   export  { handle, minReach }                                                 -> { bytes, map, exploit }
 *   lock    { handle, node, strategy:Float32Array } / unlock { handle, node }
 *   destroy { handle }
 */
let ex = null;
let cancelled = false;

async function load() {
  if (ex) return;
  const res = await fetch("/wasm/tessera_solver.wasm");
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  ex = instance.exports;
}

const f32 = (ptr, n) => new Float32Array(ex.memory.buffer, ptr, n);
const tick = () => new Promise((r) => setTimeout(r, 0));

function put32(arr) {
  const p = ex.tsr_alloc_f32(arr.length);
  f32(p, arr.length).set(arr);
  return p;
}

function exportAll(handle, minReach) {
  const exploit = ex.tsr_exploit_pct(handle);
  const len = ex.tsr_export(handle, minReach);
  const bytes = new Uint8Array(ex.memory.buffer, ex.tsr_out_ptr(handle), len).slice();
  const mapLen = ex.tsr_map_len(handle);
  const map = new Uint32Array(ex.memory.buffer, ex.tsr_map_ptr(handle), mapLen).slice();
  return { bytes, map, exploit };
}

self.onmessage = async (e) => {
  const m = e.data;
  const reply = (extra, transfer) => self.postMessage({ req: m.req, ...extra }, transfer || []);
  try {
    if (m.type === "cancel") {
      cancelled = true;
      return;
    }
    await load();
    switch (m.type) {
      case "init":
        return reply({ type: "ready" });
      case "create": {
        const cfg = put32(m.cfg);
        const board = ex.tsr_alloc(m.board.length);
        new Uint8Array(ex.memory.buffer, board, m.board.length).set(m.board);
        const r0 = put32(m.r0);
        const r1 = put32(m.r1);
        const handle = ex.tsr_create(cfg, m.cfg.length, board, m.board.length, r0, r1);
        ex.tsr_free_f32(cfg, m.cfg.length);
        ex.tsr_free(board, m.board.length);
        ex.tsr_free_f32(r0, 1326);
        ex.tsr_free_f32(r1, 1326);
        if (handle < 0) return reply({ type: "error", message: "create failed (" + handle + ")" });
        return reply({ type: "created", handle, nodes: ex.tsr_node_count(handle) });
      }
      case "run": {
        cancelled = false;
        const chunk = Math.max(1, m.chunk || 25);
        let done = 0;
        let exploit = -1;
        while (done < m.iterations && !cancelled) {
          const n = Math.min(chunk, m.iterations - done);
          ex.tsr_run(m.handle, n);
          done += n;
          if (m.restartAt && done - n < m.restartAt && done >= m.restartAt) ex.tsr_reset_average(m.handle);
          const check = done === m.iterations || done % (m.checkEvery || 100) < chunk;
          if (check) {
            exploit = ex.tsr_exploit_pct(m.handle);
            if (m.target && exploit >= 0 && exploit < m.target) {
              self.postMessage({ req: m.req, type: "progress", done, total: m.iterations, exploit });
              break;
            }
          }
          self.postMessage({ req: m.req, type: "progress", done, total: m.iterations, exploit });
          await tick();
        }
        return reply({ type: "run-done", iterations: ex.tsr_iterations(m.handle), exploit, cancelled });
      }
      case "exploit":
        return reply({ type: "exploit-done", exploit: ex.tsr_exploit_pct(m.handle) });
      case "export": {
        const r = exportAll(m.handle, m.minReach);
        return reply({ type: "export-done", ...r }, [r.bytes.buffer, r.map.buffer]);
      }
      case "lock": {
        const p = put32(m.strategy);
        const code = ex.tsr_lock(m.handle, m.node, p, m.strategy.length);
        ex.tsr_free_f32(p, m.strategy.length);
        return reply({ type: "lock-done", ok: code === 0 });
      }
      case "unlock":
        ex.tsr_unlock(m.handle, m.node);
        return reply({ type: "unlock-done" });
      case "destroy":
        ex.tsr_destroy(m.handle);
        return reply({ type: "destroy-done" });
      default:
        return reply({ type: "error", message: "unknown request " + m.type });
    }
  } catch (err) {
    reply({ type: "error", message: String((err && err.message) || err) });
  }
};
