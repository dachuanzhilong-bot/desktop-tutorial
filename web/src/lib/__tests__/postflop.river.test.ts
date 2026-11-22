import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectWorker } from "./workerHelper";
import { SolverRpc } from "../solve/client";
import { cardText, COMBOS, NC } from "../postflop/combos";
import { boardAt, decodeFlop, denseRange } from "../postflop/decode";
import type { PfFlop } from "../postflop/decode";
import { postflopKey, resolvePostflopKey } from "../postflop/positionKey";
import { contextAt, labelEdge } from "../postflop/replay";
import { graftRiver, openLine, RIVER_INPUT_VERSION, RIVER_ITERATIONS, RIVER_UPDATE, riverCacheKey, riverCards, riverJob, RiverLayer, riverOf, riverPos, riverRestartAt, riverSolveInput } from "../postflop/river";
import type { RiverBackend, RiverJob, RiverStore } from "../postflop/river";
import { rpcRiverBackend } from "../postflop/riverSolver";
import { keysToEvict, readRiverRecord, RIVER_RECORD_VERSION } from "../postflop/riverStore";
import { postflopPos } from "../practice/position";
import { createPostflopDrill } from "../postflop/drillAdapter";
import { PF_INDEX } from "../postflop/loader";
import type { PostConfig } from "../postflop/types";
import { MemoryRepo } from "../storage/memory";
import { resolveStudyHref } from "../storage/mistakes";
import { postflopLink } from "../study/links";
import { mulberry32 } from "../util/rng";

/**
 * REFACTOR_PLAN 3-3-6: the river of a v3 flop solved on the device. Fixtures written by the solver's test
 * `v3_e2e_fixture_for_the_web_tests` (solver/src/measure.rs): a v3 file of As7d2c with the shipped river settings
 * (tsp1-v3-e2e.bin, also what the E2E tests open) and one river of it solved by the solver as the device must solve it
 * (tsp1-v3-river.bin / .json).
 */
const FIX = path.resolve(__dirname, "fixtures");
const read = (f: string) => new Uint8Array(readFileSync(path.join(FIX, f)));
const v3 = (): PfFlop => ({ ...decodeFlop(read("tsp1-v3-e2e.bin")), build: "testbuild001" });
const riverBytes = read("tsp1-v3-river.bin");
const want: { riverStart: number; card: number; iterations: number; resetAt: number; update: string; pot: number; stack: number } = JSON.parse(readFileSync(path.join(FIX, "tsp1-v3-river.json"), "utf8"));

/** a backend that does not solve: counts the jobs and answers with the solver's river */
function fakeBackend(): RiverBackend & { jobs: RiverJob[] } {
  const jobs: RiverJob[] = [];
  return {
    jobs,
    solve: async (job) => {
      jobs.push(job);
      await new Promise((r) => setTimeout(r, 1));
      return riverBytes.slice();
    },
  };
}

function memoryStore(): RiverStore & { data: Map<string, Uint8Array>; gets: number } {
  const data = new Map<string, Uint8Array>();
  const s = {
    data,
    gets: 0,
    get: async (k: string) => {
      s.gets++;
      return data.get(k);
    },
    put: async (k: string, b: Uint8Array) => void data.set(k, b),
  };
  return s;
}

describe("river solved on the device (3-3-6)", () => {
  it("asks the solver for the river the precomputation has, from the file's ranges", () => {
    const f = v3();
    const job = riverJob(f, want.riverStart, want.card)!;
    const rs = f.nodes[want.riverStart];
    expect(job.board).toEqual([...boardAt(f, want.riverStart), want.card]);
    expect(job.cfg[0]).toBeCloseTo(want.pot, 5);
    expect(job.cfg[1]).toBeCloseTo(want.stack, 5);
    expect(job.cfg[0]).toBeCloseTo(f.pot + rs.inv[0] + rs.inv[1], 5);
    // alternating DCFR without an average restart (docs/14 §18), as the solver's fixture was solved
    expect([job.iterations, job.restartAt, job.update]).toEqual([RIVER_ITERATIONS, 0, "alt-dcfr"]);
    expect([RIVER_UPDATE, want.resetAt]).toEqual([want.update, 0]);
    // CFR+ restarts at half, as before
    expect(riverRestartAt(RIVER_ITERATIONS, "sim-cfr+")).toBe(RIVER_ITERATIONS / 2);
    expect(riverJob(f, want.riverStart, want.card, RIVER_ITERATIONS, "sim-cfr+")!.restartAt).toBe(RIVER_ITERATIONS / 2);
    // the input is the file's ranges with the card's combos at 0 (no pre-processing in version 1)
    expect(RIVER_INPUT_VERSION).toBe(1);
    const dense = rs.riverStart!.map(denseRange);
    for (let h = 0; h < NC; h++) {
      const blocked = COMBOS[h].c1 === want.card || COMBOS[h].c2 === want.card;
      expect(job.r0[h]).toBe(blocked ? 0 : dense[0][h]);
      expect(job.r1[h]).toBe(blocked ? 0 : dense[1][h]);
    }
    expect(riverSolveInput(f, want.riverStart, want.card)![0]).toEqual(job.r0);
    expect(riverJob(f, want.riverStart, boardAt(f, want.riverStart)[3])).toBeNull(); // the turn card
    expect(riverJob(f, 0, want.card)).toBeNull(); // not a river start
  });

  it("after bets on the flop or turn: the river's pot, stack, investments and EV count the chips put in before", () => {
    const f = v3();
    const at = f.nodes.findIndex((n) => n.riverStart && n.inv[0] > 0);
    expect(at).toBeGreaterThan(0);
    const rs = f.nodes[at];
    const card = riverCards(f, at)[0];
    const job = riverJob(f, at, card)!;
    expect(job.cfg[0]).toBeCloseTo(f.pot + 2 * rs.inv[0], 5);
    expect(job.cfg[1]).toBeCloseTo(f.stack - rs.inv[0], 5);
    // (the solver's river of another start, grafted here only to check the arithmetic)
    const river = decodeFlop(riverBytes);
    const { flop: g, root } = graftRiver(f, at, card, river);
    expect(g.nodes[root].inv).toEqual([rs.inv[0] + river.nodes[0].inv[0], rs.inv[1] + river.nodes[0].inv[1]]);
    const d = g.nodes[root].data!;
    d.best.forEach((b, j) => expect(b).toBeCloseTo(river.nodes[0].data!.best[j] - rs.inv[g.nodes[root].actor], 4));
    expect(contextAt(g, root).pot).toBeCloseTo(job.cfg[0], 4);
  });

  it("the WebAssembly solve is the solver's, bit for bit", async () => {
    const f = v3();
    const store = memoryStore();
    // the app's backend on the real worker file and .wasm
    const worker = await connectWorker();
    const real = new RiverLayer(rpcRiverBackend(() => new SolverRpc(worker)), store, want.iterations);
    const opened = await real.open(f, want.riverStart, want.card);
    expect(opened.source).toBe("solved");
    expect(real.computed).toBe(1);
    const [bytes] = [...store.data.values()];
    expect(bytes.length).toBe(riverBytes.length);
    expect(Buffer.from(bytes).equals(Buffer.from(riverBytes))).toBe(true);
  }, 60_000);

  it("grafts the river under its river start, in the flop's terms", () => {
    const f = v3();
    const river = decodeFlop(riverBytes);
    const rs = f.nodes[want.riverStart];
    const { flop: g, root } = graftRiver(f, want.riverStart, want.card, river);
    expect(f.nodes[want.riverStart].edges).toHaveLength(0); // the loaded flop is not changed
    expect(g.nodes).toHaveLength(f.nodes.length + river.nodes.length);
    expect(root).toBe(f.nodes.length);
    expect(g.nodes[want.riverStart].edges).toEqual([{ kind: want.card, amount: 0, code: root }]);
    expect(g.nodes[root].street).toBe(2);
    expect(boardAt(g, root)).toEqual(river.board);
    // the position keys: the river start's line, the card, then the river's own line
    expect(postflopKey(g, root)).toBe(`${postflopKey(f, want.riverStart)}/${cardText(want.card)}`);
    expect(postflopPos(g, root)).toBe(riverPos(f, want.riverStart, want.card));
    expect(riverOf(g, root)).toEqual({ start: want.riverStart, card: want.card });
    expect(riverOf(g, 0)).toBeNull();
    for (let i = 0; i < river.nodes.length; i++) {
      const id = root + i;
      const n = g.nodes[id];
      expect(resolvePostflopKey(g, postflopKey(g, id))).toBe(id);
      // pot and bets as in the river tree, the river start's chips added
      expect(n.inv).toEqual([rs.inv[0] + river.nodes[i].inv[0], rs.inv[1] + river.nodes[i].inv[1]]);
      expect(contextAt(g, id).pot).toBeCloseTo(contextAt(river, i).pot, 4);
      if (n.type === "decision") {
        n.edges.forEach((e, k) => {
          expect(labelEdge(g, id, k)).toEqual(labelEdge(river, i, k));
          expect(e.code).toBe(river.nodes[i].edges[k].code >= 0 ? root + river.nodes[i].edges[k].code : river.nodes[i].edges[k].code);
        });
        // EV of the flop tree: the chips put in before the river are lost from it
        n.data!.best.forEach((b, j) => expect(b).toBeCloseTo(river.nodes[i].data!.best[j] - rs.inv[n.actor], 4));
        expect(Array.from(n.data!.freq)).toEqual(Array.from(river.nodes[i].data!.freq));
      }
    }
    // reach: the river start's, times the card's chance and the pairs of hands left; over every card it adds up to
    // the share of the pairs the cards leave alive (each pair of hands blocks 4 of the live cards), as in the solver
    let total = 0;
    for (const c of riverCards(f, want.riverStart)) total += graftRiver(f, want.riverStart, c, river).flop.nodes.at(-river.nodes.length)!.reach;
    const live = riverCards(f, want.riverStart).length;
    expect(live).toBe(48);
    expect(total / rs.reach).toBeCloseTo((live - 4) / live, 4);
    // the same card twice: grafted once
    expect(graftRiver(g, want.riverStart, want.card, river).flop).toBe(g);
    // a second card adds another branch
    const other = riverCards(f, want.riverStart).find((c) => c !== want.card)!;
    const two = graftRiver(g, want.riverStart, other, river);
    expect(two.flop.nodes[want.riverStart].edges.map((e) => e.kind)).toEqual([want.card, other]);
    expect(resolvePostflopKey(two.flop, postflopKey(g, root))).toBe(root);
  });

  it("solves a river once: memory, then the store after a reload; the key holds build, position, iterations and input", async () => {
    const f = v3();
    const backend = fakeBackend();
    const store = memoryStore();
    const layer = new RiverLayer(backend, store);
    const a = await layer.open(f, want.riverStart, want.card);
    expect([a.source, layer.computed, backend.jobs.length]).toEqual(["solved", 1, 1]);
    const b = await layer.open(f, want.riverStart, want.card);
    expect([b.source, layer.computed]).toEqual(["memory", 1]);
    // on the grafted flop the card is there already
    expect((await layer.open(b.flop, want.riverStart, want.card)).root).toBe(b.root);
    // two requests at once: one solve
    const other = riverCards(f, want.riverStart).find((c) => c !== want.card)!;
    await Promise.all([layer.open(f, want.riverStart, other), layer.open(f, want.riverStart, other)]);
    expect(layer.computed).toBe(2);
    // a reload: a new layer (empty memory) reads the store
    const again = new RiverLayer(backend, store);
    const c = await again.open(f, want.riverStart, want.card);
    expect([c.source, again.computed]).toEqual(["store", 0]);
    expect(c.root).toBe(a.root);
    // the key
    const pos = riverPos(f, want.riverStart, want.card);
    expect(pos).toMatch(/^As7d2c@.+\/[2-9TJQKA][cdhs]$/);
    expect([...store.data.keys()]).toContain(riverCacheKey("testbuild001", pos, RIVER_ITERATIONS, RIVER_INPUT_VERSION));
    expect(new Set([riverCacheKey("b1", pos), riverCacheKey("b2", pos), riverCacheKey("b1", `${pos}x`), riverCacheKey("b1", pos, 2000), riverCacheKey("b1", pos, RIVER_ITERATIONS, 2)]).size).toBe(5);
    // the keys of rivers solved with sim-cfr+ (all of them before RIVER_UPDATE) keep their form, and are not read for alt-dcfr
    expect(riverCacheKey("b1", pos, 1000, 1, "sim-cfr+")).toBe(`river|b1|${pos}|n1000|in1`);
    expect(riverCacheKey("b1", pos)).toBe(`river|b1|${pos}|n1000|in1|alt-dcfr`);
    // another build of the file, or another iteration count: solved again
    await new RiverLayer(backend, store).open({ ...f, build: "otherbuild99" }, want.riverStart, want.card);
    const n2000 = new RiverLayer(backend, store, 2000);
    await n2000.open(f, want.riverStart, want.card);
    expect(n2000.computed).toBe(1);
    expect(backend.jobs.at(-1)!.iterations).toBe(2000);
    // a damaged stored record is solved again
    const broken = memoryStore();
    broken.data.set(riverCacheKey("testbuild001", pos), new Uint8Array([84, 83, 80, 49, 9]));
    const fresh = new RiverLayer(backend, broken);
    expect((await fresh.open(f, want.riverStart, want.card)).source).toBe("solved");
  });

  it("opens a line through a river (deep links, records)", async () => {
    const f = v3();
    const layer = new RiverLayer(fakeBackend(), memoryStore());
    const river = decodeFlop(riverBytes);
    const { flop: g, root } = graftRiver(f, want.riverStart, want.card, river);
    const deep = root + river.nodes.findIndex((n, i) => i > 0 && n.type === "decision");
    const line = postflopKey(g, deep);
    // not kept yet: nothing is solved when asked not to
    expect(await openLine(layer, f, line, { solve: false })).toEqual({ flop: f, node: null, pending: true });
    expect(layer.computed).toBe(0);
    const opened = await openLine(layer, f, line);
    expect(layer.computed).toBe(1);
    expect(postflopKey(opened.flop, opened.node!)).toBe(line);
    const cached = await openLine(layer, f, line, { solve: false });
    expect(cached.node).not.toBeNull();
    expect(layer.computed).toBe(1);
    // lines of the flop and turn need no river; a card that is on the board, or a line the river has not: null
    expect((await openLine(layer, f, postflopKey(f, want.riverStart))).node).toBe(want.riverStart);
    const head = postflopKey(f, want.riverStart);
    expect((await openLine(layer, f, `${head}/${cardText(boardAt(f, want.riverStart)[0])}`)).node).toBeNull();
    expect((await openLine(layer, f, `${line}-B999`)).node).toBeNull();
  });

  it("the practice drill plays on through a river (play-through) and asks river spots (spot drill) with the layer", async () => {
    const f = v3();
    const backend = fakeBackend();
    const layer = new RiverLayer(backend, memoryStore());
    const make = (config: Partial<PostConfig>, seed: number, river = true, repo = new MemoryRepo()) =>
      createPostflopDrill({
        config: { kind: "through", scenario: "srp-btn-bb", hero: null, streets: [0, 1, 2], rng: false, timer: 0, flop: 0, ...config },
        repo,
        rnd: mulberry32(seed),
        now: () => 1_800_000_000_000,
        index: async () => PF_INDEX,
        flop: async () => f,
        ...(river && { river: (g: PfFlop, n: number, c: number) => layer.open(g, n, c) }),
      });
    // play-through: hands that reach the river get a card dealt and the river opened; the hero is asked there
    let onRiver = 0;
    for (let seed = 1; seed <= 60 && onRiver < 3; seed++) {
      const d = make({}, seed);
      let r = (await d.start())!;
      for (let guard = 0; guard < 10 && r.q; guard++) {
        const node = r.flop.nodes[r.q.nodeId];
        if (node.street === 2) {
          onRiver++;
          const dealt = r.steps.find((s) => s.card !== null && r.flop.nodes[s.nodeId].riverStart);
          expect(dealt).toBeDefined();
          expect(r.flop.nodes[dealt!.toNode].street).toBe(2);
          expect(riverOf(r.flop, r.q.nodeId)).toEqual({ start: dealt!.nodeId, card: dealt!.card });
          // the river card is not one of the hero's or the board's
          expect([COMBOS[r.combo].c1, COMBOS[r.combo].c2, ...f.board]).not.toContain(dealt!.card);
          break;
        }
        const next = await d.next(r, { ...d.answer(r, 0), score: 0, ms: 1, timeout: false, hint: false });
        if (!next) break;
        r = next;
      }
    }
    expect(onRiver).toBeGreaterThanOrEqual(1);
    expect(layer.computed).toBeGreaterThanOrEqual(1);
    // without the layer a hand stops at the river start, as before
    for (let seed = 1; seed <= 30; seed++) {
      const d = make({}, seed, false);
      const r = (await d.start())!;
      if (r.ended === "unsolved") expect(r.flop.nodes[r.lastNode].riverStart).toBeDefined();
      if (r.q) expect(r.flop.nodes[r.q.nodeId].street).toBeLessThan(2);
    }
    // spot drill on the river only: a river start is picked, its river solved, a river decision asked and recorded by position
    const repo = new MemoryRepo();
    const spot = make({ kind: "spot", streets: [2] }, 7, true, repo);
    const r = (await spot.start())!;
    expect(r.q).not.toBeNull();
    expect(r.flop.nodes[r.q!.nodeId].street).toBe(2);
    expect(r.steps.some((s) => s.card !== null && r.flop.nodes[s.nodeId].riverStart)).toBe(true);
    spot.record(r, { ...spot.answer(r, 0), score: 0, ms: 1, timeout: false, hint: false });
    await new Promise((res) => setTimeout(res, 10));
    const [saved] = await repo.allAttempts();
    expect(saved.pos).toBe(postflopPos(r.flop, r.q!.nodeId));
    expect(saved.pos).toContain(`/${cardText(riverOf(r.flop, r.q!.nodeId)!.card)}`);
    expect(saved.build).toBe("testbuild001");
    // the record's Study link: the river line is accepted through the layer (nothing is solved for it)
    const before = layer.computed;
    const src = { manifest: async () => Promise.reject(new Error("none")), flops: PF_INDEX.flops, flop: async () => f };
    expect(await resolveStudyHref(saved, { ...src, river: layer })).toBe(postflopLink("srp-btn-bb", saved.pos));
    expect(await resolveStudyHref(saved, src)).toBeNull(); // without the layer, as before 3-3-6
    // a river card on the board: no link
    const at = riverOf(r.flop, r.q!.nodeId)!.start;
    const onBoard = `${postflopPos(f, at)}/${cardText(f.board[0])}`;
    expect(await resolveStudyHref({ ...saved, pos: onBoard }, { ...src, river: layer })).toBeNull();
    expect(layer.computed).toBe(before);
  });

  it("the stored records: another version or shape is not read; the least recently used go", () => {
    const tsp = new Uint8Array([84, 83, 80, 49, 2, 0]);
    expect(readRiverRecord({ key: "k", v: RIVER_RECORD_VERSION, bytes: tsp, ts: 1 }, "k")).toBe(tsp);
    // older or unknown shapes: no version, another version, another key, not bytes, not a TSP1 file
    expect(readRiverRecord({ key: "k", bytes: tsp, ts: 1 }, "k")).toBeUndefined();
    expect(readRiverRecord({ key: "k", v: 0, bytes: tsp }, "k")).toBeUndefined();
    expect(readRiverRecord({ key: "j", v: RIVER_RECORD_VERSION, bytes: tsp }, "k")).toBeUndefined();
    expect(readRiverRecord({ key: "k", v: RIVER_RECORD_VERSION, bytes: Array.from(tsp) }, "k")).toBeUndefined();
    expect(readRiverRecord({ key: "k", v: RIVER_RECORD_VERSION, bytes: new Uint8Array(6) }, "k")).toBeUndefined();
    expect(readRiverRecord(null, "k")).toBeUndefined();
    expect(readRiverRecord("TSP1", "k")).toBeUndefined();
    const recs = [
      { key: "a", ts: 5, ok: true },
      { key: "b", ts: 1, ok: true },
      { key: "old", ts: 9, ok: false },
      { key: "c", ts: 3, ok: true },
    ];
    expect(keysToEvict(recs, 2)).toEqual(["old", "b"]);
    expect(keysToEvict(recs, 10)).toEqual(["old"]);
  });
});
