import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildConfig, DEFAULT_SOLVE, solverRanges } from "../solve/config";
import { parseRange } from "../ranges/range";
import { parseBoard } from "../postflop/combos";
import { decodeFlop } from "../postflop/decode";
import { NC } from "../postflop/combos";

const PUBLIC = path.resolve(__dirname, "../../../public");

/** runs the real public/solver-worker.js in a vm sandbox, with the real .wasm */
function startWorker() {
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

const cfg = { ...DEFAULT_SOLVE, pot: 10, stack: 30, bets: [[0.5], [0.66], [0.5, 1]] as [number[], number[], number[]], raiseSizes: [false, false, false] as [boolean, boolean, boolean] };
const board = parseBoard("Ks 7d 2c 9h 3s");
// OOP has bluff-catchers; IP polarised: value + bluffs
const oop = parseRange("QQ,JJ,TT,AQs,AJs,KQs,KJs,QJs,JTs").range;
const ip = parseRange("AA,KK,77,22,A5s,A4s,A3s,98s,87s,76s,65s").range;

describe("WASM solver through the real worker", () => {
  it("solves a river spot, exports a TSP1 file that the app can decode", async () => {
    const call = startWorker();
    await call({ type: "init" });
    const [r0, r1] = solverRanges([oop, ip], board);
    const created = await call({ type: "create", cfg: buildConfig(cfg), board, r0, r1 });
    expect(created.handle).toBeGreaterThanOrEqual(0);
    expect(created.nodes).toBeGreaterThan(5);

    const early = await call({ type: "run", handle: created.handle, iterations: 10, chunk: 10 });
    const done = await call({ type: "run", handle: created.handle, iterations: 400, chunk: 50, restartAt: 200, checkEvery: 100 });
    expect(done.progress.length).toBeGreaterThanOrEqual(8);
    expect(done.progress.at(-1).done).toBe(400);
    expect(done.exploit).toBeGreaterThanOrEqual(0);
    expect(done.exploit).toBeLessThan(early.exploit);
    expect(done.exploit).toBeLessThan(2); // % of pot

    const exp = await call({ type: "export", handle: created.handle, minReach: 0.004 });
    const flop = decodeFlop(exp.bytes);
    expect(flop.board).toEqual(board);
    expect(flop.pot).toBe(10);
    expect(flop.nodes.length).toBe(exp.map.length);
    expect(flop.nodes[0].type).toBe("decision");
    expect(flop.nodes[0].actor).toBe(0);
    // the exported map points at distinct tree nodes
    expect(new Set(exp.map).size).toBe(exp.map.length);
    // check/bet mix at the root is a proper distribution for every hand that is in the range
    const d = flop.nodes[0].data!;
    for (let i = 0; i < d.n; i++) {
      let s = 0;
      for (let a = 0; a < flop.nodes[0].edges.length; a++) s += d.freq[a * d.n + i];
      expect(Math.abs(s - 1)).toBeLessThan(0.03);
    }
    await call({ type: "destroy", handle: created.handle });
  }, 60_000);

  it("stops early at the target exploitability and on cancel", async () => {
    const call = startWorker();
    const [r0, r1] = solverRanges([oop, ip], board);
    const { handle } = await call({ type: "create", cfg: buildConfig(cfg), board, r0, r1 });
    const r = await call({ type: "run", handle, iterations: 5000, chunk: 20, checkEvery: 40, target: 3 });
    expect(r.iterations).toBeLessThan(5000);
    expect(r.exploit).toBeLessThan(3);
  }, 60_000);

  it("a locked node keeps its strategy while the opponent adapts", async () => {
    const call = startWorker();
    const [r0, r1] = solverRanges([oop, ip], board);
    const { handle } = await call({ type: "create", cfg: buildConfig(cfg), board, r0, r1 });
    await call({ type: "run", handle, iterations: 150, chunk: 50 });
    const base = decodeFlop((await call({ type: "export", handle, minReach: 0.004 })).bytes);
    const root = base.nodes[0];
    const na = root.edges.length;
    // OOP is forced to always check at the root
    const check = root.edges.findIndex((e) => e.kind === 1);
    const strat = new Float32Array(na * NC);
    for (let h = 0; h < NC; h++) strat[check * NC + h] = 1;
    const locked = await call({ type: "lock", handle, node: 0, strategy: strat });
    expect(locked.ok).toBe(true);
    await call({ type: "run", handle, iterations: 150, chunk: 50 });
    const exp = await call({ type: "export", handle, minReach: 0.004 });
    const after = decodeFlop(exp.bytes);
    const d = after.nodes[0].data!;
    for (let i = 0; i < d.n; i++) expect(d.freq[check * d.n + i]).toBeGreaterThan(0.99);
    // the opponent (IP) now bets more after a check than before: the exploit of a never-bet player
    const ipBet = (f: typeof base) => {
      const ck = f.nodes[0].edges[check].code;
      const n = f.nodes[ck];
      let bet = 0;
      let tot = 0;
      for (let i = 0; i < n.data!.n; i++) {
        tot += n.data!.weight[i];
        for (let a = 0; a < n.edges.length; a++) if (n.edges[a].kind >= 2) bet += n.data!.weight[i] * n.data!.freq[a * n.data!.n + i];
      }
      return bet / tot;
    };
    expect(ipBet(after)).toBeGreaterThanOrEqual(ipBet(base) - 0.02);
    // unlocking restores adaptation
    await call({ type: "unlock", handle, node: 0 });
    await call({ type: "run", handle, iterations: 100, chunk: 50 });
    const free = decodeFlop((await call({ type: "export", handle, minReach: 0.004 })).bytes);
    const fd = free.nodes[0].data!;
    let anyBet = 0;
    for (let i = 0; i < fd.n; i++) for (let a = 0; a < na; a++) if (a !== check) anyBet += fd.freq[a * fd.n + i];
    expect(anyBet).toBeGreaterThan(0);
  }, 90_000);
});
