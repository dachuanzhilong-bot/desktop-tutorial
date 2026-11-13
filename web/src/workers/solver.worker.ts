/// <reference lib="webworker" />
// Runs the Rust solver compiled to WebAssembly off the main thread, for Solve and ICM (messages: lib/solve/protocol.ts).
import { createSolverHost } from "../lib/solve/host";
import type { SolverExports } from "../lib/solve/host";
import { SOLVER_WASM } from "../lib/solve/protocol";
import type { SolverRequest } from "../lib/solve/protocol";
import { withBase } from "../lib/util/base";

// the bundled worker lives under /_next/static: the module is found through the app's base path, like every other file
const scope = self as unknown as DedicatedWorkerGlobalScope;

const handle = createSolverHost(
  async () => {
    const res = await scope.fetch(withBase(SOLVER_WASM));
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    return instance.exports as unknown as SolverExports;
  },
  (m, transfer = []) => scope.postMessage(m, transfer),
);

scope.onmessage = (e: MessageEvent<SolverRequest>) => void handle(e.data);
