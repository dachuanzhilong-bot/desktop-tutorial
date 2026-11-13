import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectWorker, PUBLIC, startWorker } from "./workerHelper";
import { SolverClient, SolverRpc } from "../solve/client";
import { DEFAULT_SOLVE, buildConfig, solverRanges } from "../solve/config";
import { REPLY } from "../solve/protocol";
import type { SolverCall } from "../solve/protocol";
import { IcmClient } from "../icm/client";
import { toConfig } from "../icm/model";
import { parseRange } from "../ranges/range";
import { parseBoard } from "../postflop/combos";
import { decodeFlop } from "../postflop/decode";

// lib/solve/protocol.ts is the one description of the messages: the worker answers each request with the reply
// type REPLY names, and the clients accept nothing else.
const cfg = { ...DEFAULT_SOLVE, pot: 10, stack: 30, bets: [[0.5], [0.66], [0.5, 1]] as [number[], number[], number[]], raiseSizes: [false, false, false] as [boolean, boolean, boolean] };
const board = parseBoard("Ks 7d 2c 9h 3s");
const ranges: [ReturnType<typeof parseRange>["range"], ReturnType<typeof parseRange>["range"]] = [parseRange("QQ,JJ,TT,AQs,KQs").range, parseRange("AA,KK,77,A5s,98s").range];

describe("solver worker protocol", () => {
  it("every request is answered with the reply type of REPLY", async () => {
    const call = startWorker();
    const seen = new Map<SolverCall, string>();
    const note = async <K extends SolverCall, R extends { type: string }>(k: K, p: Promise<R>): Promise<R> => {
      const r = await p;
      seen.set(k, r.type);
      return r;
    };
    await note("init", call({ type: "init" }));
    const [r0, r1] = solverRanges(ranges, board);
    const { handle } = await note("create", call({ type: "create", cfg: buildConfig(cfg), board, r0, r1 }));
    await note("run", call({ type: "run", handle, iterations: 20, chunk: 10 }));
    await note("exploit", call({ type: "exploit", handle }));
    const exp = await note("export", call({ type: "export", handle, minReach: 0.004 }));
    const na = decodeFlop(exp.bytes).nodes[0].edges.length;
    await note("lock", call({ type: "lock", handle, node: 0, strategy: new Float32Array(na * 1326).fill(1 / na) }));
    await note("unlock", call({ type: "unlock", handle, node: 0 }));
    await note("destroy", call({ type: "destroy", handle }));
    const eqFile = readFileSync(path.join(PUBLIC, "data/equity169.bin"));
    await note("icmInit", call({ type: "icmInit", eq: new Uint16Array(eqFile.buffer.slice(eqFile.byteOffset, eqFile.byteOffset + eqFile.byteLength)) }));
    const icm = await note("icmCreate", call({ type: "icmCreate", cfg: toConfig({ stacks: [10, 10], sb: 0.5, bb: 1, ante: 0, payouts: [1] }) }));
    await note("icmRun", call({ type: "icmRun", handle: icm.handle, iterations: 50, chunk: 25 }));
    await note("icmExport", call({ type: "icmExport", handle: icm.handle }));
    await note("icmDestroy", call({ type: "icmDestroy", handle: icm.handle }));
    expect(Object.fromEntries(seen)).toEqual(REPLY);
  });

  it("an unknown request and a failed create come back as errors, with the request's id", async () => {
    const call = startWorker();
    await expect(call({ type: "nope" as SolverCall } as Parameters<typeof call>[0])).rejects.toThrow(/unknown request nope/);
    await expect(call({ type: "create", cfg: buildConfig(cfg), board: [0, 1], r0: new Float32Array(1326), r1: new Float32Array(1326) })).rejects.toThrow(/create failed/);
  });

  it("SolverClient solves, locks and exports through the worker file", async () => {
    const client = new SolverClient(await connectWorker());
    await client.init();
    expect(await client.create({ board, cfg, ranges })).toBeGreaterThan(5);
    const seen: number[] = [];
    const r = await client.run({ iterations: 200, chunk: 50, restartAt: 100, onProgress: (p) => seen.push(p.done) });
    expect(r).toMatchObject({ iterations: 200, cancelled: false });
    expect(seen.at(-1)).toBe(200);
    const exp = await client.export();
    expect(decodeFlop(exp.bytes).nodes.length).toBe(exp.map.length);
    expect(await client.exploit()).toBeCloseTo(exp.exploit, 6);
    await client.destroy();
  });

  it("cancel stops a run after its current chunk, and the run reports it", async () => {
    const client = new SolverClient(await connectWorker());
    await client.create({ board, cfg, ranges });
    const r = client.run({ iterations: 100_000, chunk: 10, onProgress: (p) => p.done >= 30 && client.cancel() });
    const done = await r;
    expect(done.cancelled).toBe(true);
    expect(done.iterations).toBeLessThan(100_000);
  });

  it("IcmClient talks to the same worker", async () => {
    const realFetch = globalThis.fetch;
    const eq = readFileSync(path.join(PUBLIC, "data/equity169.bin"));
    globalThis.fetch = (async () => new Response(eq)) as typeof fetch;
    try {
      const client = new IcmClient(await connectWorker());
      const out = await client.solve({ stacks: [10, 10], sb: 0.5, bb: 1, ante: 0, payouts: [1] }, { iterations: 400 });
      expect(out.solution.players).toBe(2);
      expect(out.iterations).toBe(400);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("a reply of another type than the request's is rejected, not taken for the answer", async () => {
    const worker = {
      onmessage: null as ((e: { data: unknown }) => void) | null,
      onerror: null,
      postMessage: (m: { req: number }) => queueMicrotask(() => worker.onmessage?.({ data: { req: m.req, type: "destroy-done" } })),
      terminate: () => {},
    };
    const rpc = new SolverRpc(worker as unknown as Worker);
    await expect(rpc.call({ type: "init" })).rejects.toThrow(/unexpected reply destroy-done \(expected ready\)/);
  });
});
