import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const PUBLIC = path.resolve(__dirname, "../../../public");

/** runs the real public/solver-worker.js in a vm sandbox, with the real .wasm */
export function startWorker() {
  const wasm = readFileSync(path.join(PUBLIC, "wasm/tessera_solver.wasm"));
  const waiting = new Map<number, { resolve: (m: any) => void; progress: any[] }>();
  const sandbox: any = {
    self: {} as any,
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
  sandbox.self.postMessage = (m: any) => {
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
  const call = (msg: any) =>
    new Promise<any>((resolve, reject) => {
      const r = req++;
      waiting.set(r, { resolve: (m) => (m.type === "error" ? reject(new Error(m.message)) : resolve(m)), progress: [] });
      sandbox.self.onmessage({ data: { req: r, ...msg } });
    });
  return call;
}

