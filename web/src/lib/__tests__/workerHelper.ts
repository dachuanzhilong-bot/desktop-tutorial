import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const PUBLIC = path.resolve(__dirname, "../../../public");

/** runs the real public/solver-worker.js in a vm sandbox, with the real .wasm */
export function startWorker() {
  const wasm = readFileSync(path.join(PUBLIC, "wasm/tessera_solver.wasm"));
  /** a message from the worker (shape depends on the request type) */
  type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- test harness: replies are checked by each test
  const waiting = new Map<number, { resolve: (m: Msg) => void; progress: Msg[] }>();
  const self: { postMessage?: (m: Msg) => void; onmessage?: (e: { data: Msg }) => void } = {};
  const sandbox = {
    self,
    fetch: async () => ({ arrayBuffer: async () => wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }),
    setTimeout,
    WebAssembly,
    Float32Array,
    Uint8Array,
    Uint32Array,
    Promise,
    Math,
    String,
  };
  self.postMessage = (m: Msg) => {
    const w = waiting.get(m.req);
    if (!w) return;
    if (m.type === "progress") w.progress.push(m);
    else {
      waiting.delete(m.req);
      w.resolve({ ...m, progress: w.progress });
    }
  };
  vm.runInNewContext(readFileSync(path.join(PUBLIC, "solver-worker.js"), "utf8"), sandbox);
  let req = 1;
  const call = (msg: Msg) =>
    new Promise<Msg>((resolve, reject) => {
      const r = req++;
      waiting.set(r, { resolve: (m) => (m.type === "error" ? reject(new Error(m.message)) : resolve(m)), progress: [] });
      self.onmessage!({ data: { req: r, ...msg } });
    });
  return call;
}

