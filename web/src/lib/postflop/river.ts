/**
 * The river of a `TSP1` v3 flop, solved on the device (REFACTOR_PLAN 3-3-6, docs/14 §11).
 *
 * A v3 file has no river node: at every river start (the chance node that deals the river) it holds both players'
 * reach ranges (docs/03 "ポストフロップ: TSP1 v3"). When a river card is chosen there, this layer solves that river with
 * the WebAssembly solver (the same worker as the Solve screen: lib/solve/client.ts `SolverRpc`), gets it back as a
 * `TSP1` file, and grafts its nodes under the river start, so every screen keeps walking one `PfFlop` (node ids, the
 * position keys, `contextAt`, the practice drill). Results are kept in memory and in IndexedDB (riverStore.ts) under
 * the build ID of the flop file, the position key of the river and the iterations: the same river is solved once.
 *
 * What is solved, exactly as `river_tree_of` / `resolve_rivers_alone` of solver/src/allcards.rs (checked against the
 * solver by the fixture `tsp1-v3-river.bin`): the 5 card board, the pot of the river start (`pot + inv0 + inv1`), the
 * stack behind (`stack - inv0`), the precomputation's river settings (`RIVER_SETTINGS`), the ranges of the river start
 * with the river card's combos at 0 (`riverSolveInput`), `RIVER_ITERATIONS` iterations, the average restarted at half.
 */
import { buildConfig } from "../solve/config";
import type { SolveConfig } from "../solve/config";
import { postflopPos } from "../practice/position";
import { cardText, COMBOS, NC } from "./combos";
import { boardAt, decodeFlop, denseRange, riverStartRanges } from "./decode";
import type { PfFlop, PfNode } from "./decode";
import { resolvePostflopKey, ROOT_KEY } from "./positionKey";
import { stepsTo } from "./replay";

/**
 * Iterations of one river solve on the device. Provisional: 3,000 until REFACTOR_PLAN 3-3-4 decides N from the
 * production run of 3-3-3 (docs/14 §9-5). The cache key holds it, so results of another N are not reused.
 */
export const RIVER_ITERATIONS = 3000;

/**
 * Version of the step "ranges read from the file -> the ranges the river is solved from" (`riverSolveInput`). It is the
 * identity today. 3-3-3 found that re-solving from the reach ranges alone lets lines played with ~1e-5 frequency be
 * exploited; a fix (e.g. mixing in a thin full range) goes into `riverSolveInput` with a new version here, which is
 * part of the cache key.
 */
export const RIVER_INPUT_VERSION = 1;

/**
 * The river settings of the precomputation: `Config::default()` of solver/src/postflop.rs, which gen_postflop uses for
 * every scenario (bets 50% / 100% of the pot, raises only all-in, all-in allowed, raise x3, all-in when a bet would
 * leave less than 67% of the stack behind... as the solver's tree builder reads them). Only the river part matters on a
 * 5 card board; the rest is there because the solver's configuration has every street.
 */
export const RIVER_SETTINGS: Omit<SolveConfig, "pot" | "stack"> = {
  bets: [[0.33, 0.75], [0.66], [0.5, 1]],
  raiseMult: 3,
  allinRatio: 0.67,
  allowAllin: true,
  raiseSizes: [true, false, false],
  turnCards: 6,
  riverCards: 2,
  flopRunouts: 120,
  seed: 7,
};

/**
 * The ranges [OOP, IP] (1326 wide) the river is solved from after `card` at the river start `nodeId`: today the file's
 * reach ranges with the card's combos at 0 (`riverStartRanges`). The one place to pre-process them (RIVER_INPUT_VERSION).
 * null when the node is not a river start or the card is not live there.
 */
export function riverSolveInput(flop: PfFlop, nodeId: number, card: number): [Float32Array, Float32Array] | null {
  return riverStartRanges(flop, nodeId, card);
}

/** the cards that can be dealt at a river start (not on the board), in card order */
export function riverCards(flop: PfFlop, nodeId: number): number[] {
  const board = boardAt(flop, nodeId);
  const out: number[] = [];
  for (let c = 0; c < 52; c++) if (!board.includes(c)) out.push(c);
  return out;
}

/** is `nodeId` a river start whose river is solved on the device */
export const isRiverStart = (flop: PfFlop, nodeId: number): boolean => !!flop.nodes[nodeId]?.riverStart;

/** what the solver is asked for one river */
export interface RiverJob {
  cfg: number[];
  board: number[];
  r0: Float32Array;
  r1: Float32Array;
  iterations: number;
  /** restart the average after this many iterations */
  restartAt: number;
}

/** the position of the river's first decision, `<flop>@<line>/<card>`: what the cache key and the records hold */
export const riverPos = (flop: PfFlop, nodeId: number, card: number): string => `${postflopPos(flop, nodeId)}/${cardText(card)}`;

/** the solve of `card` at river start `nodeId`; null when it is not one, or the card is not live there */
export function riverJob(flop: PfFlop, nodeId: number, card: number, iterations = RIVER_ITERATIONS): RiverJob | null {
  const node = flop.nodes[nodeId];
  const ranges = node?.riverStart ? riverSolveInput(flop, nodeId, card) : null;
  if (!node || !ranges) return null;
  // a street starts with equal investments: the pot of the river and the stack behind
  const cfg: SolveConfig = { ...RIVER_SETTINGS, pot: flop.pot + node.inv[0] + node.inv[1], stack: flop.stack - node.inv[0] };
  return { cfg: buildConfig(cfg), board: [...boardAt(flop, nodeId), card], r0: ranges[0], r1: ranges[1], iterations, restartAt: Math.floor(iterations / 2) };
}

/** the cache key of a river: build ID of the flop file, the river's position key, the iterations, the input's version */
export const riverCacheKey = (build: string, pos: string, iterations = RIVER_ITERATIONS, input = RIVER_INPUT_VERSION): string => `river|${build}|${pos}|n${iterations}|in${input}`;

/** sum over pairs of combos that share no card of r0[h0] * r1[h1] */
function pairMass(r0: Float32Array, r1: Float32Array): number {
  let s0 = 0;
  let s1 = 0;
  let same = 0;
  const a0 = new Float64Array(52);
  const a1 = new Float64Array(52);
  for (let h = 0; h < NC; h++) {
    const { c1, c2 } = COMBOS[h];
    s0 += r0[h];
    s1 += r1[h];
    same += r0[h] * r1[h];
    a0[c1] += r0[h];
    a0[c2] += r0[h];
    a1[c1] += r1[h];
    a1[c2] += r1[h];
  }
  let shared = 0;
  for (let c = 0; c < 52; c++) shared += a0[c] * a1[c];
  return s0 * s1 - shared + same;
}

/**
 * `flop` with the solved river `river` (a `TSP1` of the 5 card river tree) under river start `nodeId`, card `card`:
 * the river's nodes are appended, the river start gets an edge for the card. The river's numbers are put in the
 * flop's terms, as a v2 file holds its river nodes: investments since the flop (`inv` + the river start's), EV of the
 * flop tree (the chips put in before the river are part of it: minus the river start's investment), and the line's
 * probability (`reach` x the chance of this card and of the two ranges after it). Returns the river's first node.
 * A card already grafted is not grafted twice. `flop` itself is not changed.
 */
export function graftRiver(flop: PfFlop, nodeId: number, card: number, river: PfFlop): { flop: PfFlop; root: number } {
  const rs = flop.nodes[nodeId];
  if (!rs?.riverStart) throw new Error(`node ${nodeId} is not a river start`);
  const had = rs.edges.find((e) => e.kind === card && e.code >= 0);
  if (had) return { flop, root: had.code };
  const base = flop.nodes.length;
  const ranges = riverStartRanges(flop, nodeId, card);
  if (!ranges) throw new Error(`card ${card} is not live at node ${nodeId}`);
  // P(card | line) = 1 / live cards (the solver's chance node), and the pairs of hands left once the card is dealt
  const live = 52 - boardAt(flop, nodeId).length;
  const before = pairMass(denseRange(rs.riverStart[0]), denseRange(rs.riverStart[1]));
  const factor = before > 0 ? pairMass(ranges[0], ranges[1]) / before / live : 0;
  const edgeIndex = rs.edges.length;
  const start: PfNode = { ...rs, edges: [...rs.edges, { kind: card, amount: 0, code: base }] };
  const grafted = river.nodes.map((n): PfNode => {
    const data = n.data && { ...n.data, best: n.data.best.map((b) => b - rs.inv[n.actor]) };
    return {
      ...n,
      id: base + n.id,
      inv: [rs.inv[0] + n.inv[0], rs.inv[1] + n.inv[1]],
      reach: rs.reach * factor * n.reach,
      edges: n.edges.map((e) => (e.code >= 0 ? { ...e, code: base + e.code } : e)),
      data,
      parent: n.parent >= 0 ? base + n.parent : nodeId,
      parentEdge: n.parent >= 0 ? n.parentEdge : edgeIndex,
    };
  });
  const nodes = flop.nodes.slice();
  nodes[nodeId] = start;
  nodes.push(...grafted);
  return { flop: { ...flop, nodes }, root: base };
}

/** solves one river (the worker in the app, the real worker file in the tests) */
export interface RiverBackend {
  /** get ready to solve (start the worker, load the module) without solving anything */
  warm?(): void;
  solve(job: RiverJob, onProgress?: (done: number, total: number) => void): Promise<Uint8Array>;
}

/** where solved rivers are kept between visits (riverStore.ts: IndexedDB); losing them only costs a new solve */
export interface RiverStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

export type RiverSource = "solved" | "memory" | "store";

export interface RiverOpened {
  flop: PfFlop;
  /** the river's first node in `flop` */
  root: number;
  source: RiverSource;
  /** ms from the request to the grafted flop */
  ms: number;
  /** "solved": ms the backend took (the solver worker: start, module, iterations, export, the replies) */
  solveMs?: number;
}

/** rivers kept in memory (each `TSP1` is ~10-60 KB) */
const MEMORY_LIMIT = 48;

/**
 * Opens the rivers of v3 flops: from memory, else from the store, else solved by the backend (then kept in both).
 * `computed` counts the solves this layer has run (what the tests and the screen's status read).
 */
export class RiverLayer {
  computed = 0;
  private mem = new Map<string, Uint8Array>();
  private running = new Map<string, Promise<{ bytes: Uint8Array; ms: number }>>();

  constructor(
    private backend: RiverBackend,
    private store: RiverStore | null = null,
    readonly iterations = RIVER_ITERATIONS,
  ) {}

  private remember(key: string, bytes: Uint8Array) {
    this.mem.delete(key);
    this.mem.set(key, bytes);
    while (this.mem.size > MEMORY_LIMIT) this.mem.delete(this.mem.keys().next().value!);
  }

  /** start the solver (worker, module) ahead of a river that may be asked for soon, e.g. when a river start is shown */
  warm() {
    this.backend.warm?.();
  }

  /** the solved river if it is in memory or in the store (nothing is solved); null when it is not there */
  async cached(flop: PfFlop, nodeId: number, card: number): Promise<RiverOpened | null> {
    const t0 = now();
    const key = riverCacheKey(flop.build ?? "", riverPos(flop, nodeId, card), this.iterations);
    const hit = this.mem.get(key);
    if (hit) return { ...graftRiver(flop, nodeId, card, decodeFlop(hit)), source: "memory", ms: now() - t0 };
    const stored = await this.store?.get(key).catch(() => undefined);
    if (!stored) return null;
    let river: PfFlop;
    try {
      river = decodeFlop(stored);
    } catch {
      return null; // a damaged record: solved again
    }
    this.remember(key, stored);
    return { ...graftRiver(flop, nodeId, card, river), source: "store", ms: now() - t0 };
  }

  /** the river of `card` at river start `nodeId` of `flop`, grafted (solved only when it is not kept) */
  async open(flop: PfFlop, nodeId: number, card: number, onProgress?: (done: number, total: number) => void): Promise<RiverOpened> {
    const t0 = now();
    const job = riverJob(flop, nodeId, card, this.iterations);
    if (!job) throw new Error(`no river to solve at node ${nodeId} with card ${card}`);
    const known = flop.nodes[nodeId].edges.find((e) => e.kind === card && e.code >= 0);
    if (known) return { flop, root: known.code, source: "memory", ms: 0 };
    const hit = await this.cached(flop, nodeId, card);
    if (hit) return hit;
    const key = riverCacheKey(flop.build ?? "", riverPos(flop, nodeId, card), this.iterations);
    let p = this.running.get(key);
    if (!p) {
      this.computed++;
      const t1 = now();
      p = this.backend.solve(job, onProgress).then((bytes) => {
        this.remember(key, bytes);
        this.store?.put(key, bytes).catch(() => {});
        return { bytes, ms: now() - t1 };
      });
      this.running.set(key, p);
      p.finally(() => this.running.delete(key)).catch(() => {});
    }
    const { bytes, ms } = await p;
    return { ...graftRiver(flop, nodeId, card, decodeFlop(bytes)), source: "solved", ms: now() - t0, solveMs: ms };
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The node a line (a position key without the flop) names in a v3 flop, solving (or reading from the cache) the river it
 * goes through: the flop with that river grafted, and the node (null when the tree has no such line). `solve: false`
 * only uses rivers already kept; a river that is not gives `{ flop, node: null, pending: true }`.
 */
export async function openLine(layer: RiverLayer, flop: PfFlop, line: string, opts: { solve?: boolean } = {}): Promise<{ flop: PfFlop; node: number | null; pending?: boolean }> {
  const direct = resolvePostflopKey(flop, line);
  if (direct !== null || flop.version !== 3 || line === ROOT_KEY) return { flop, node: direct };
  // the river start on the way: the longest prefix of the line, cut before a card, that is a river start
  const parts = line.split("/");
  for (let i = parts.length - 1; i >= 1; i--) {
    const head = parts.slice(0, i).join("/");
    const at = resolvePostflopKey(flop, head);
    if (at === null || !flop.nodes[at].riverStart) continue;
    const card = riverCards(flop, at).find((c) => cardText(c) === parts[i]);
    if (card === undefined) return { flop, node: null };
    const opened = opts.solve === false ? await layer.cached(flop, at, card) : await layer.open(flop, at, card);
    if (!opened) return { flop, node: null, pending: true };
    const node = resolvePostflopKey(opened.flop, line);
    return { flop: opened.flop, node };
  }
  return { flop, node: null };
}

/**
 * Does a v3 flop have the line, as far as can be told without solving: true when it is on the flop / turn, on a river
 * kept in the cache, or goes through a river start and a live card whose river is not solved yet (Study solves it when
 * the line is opened, and falls back to the river's first node if the rest is not there).
 */
export async function lineAvailable(layer: RiverLayer, flop: PfFlop, line: string): Promise<boolean> {
  const r = await openLine(layer, flop, line, { solve: false });
  return r.node !== null || !!r.pending;
}

/** the river start and card a node of a grafted flop lies under (null on the flop and turn) */
export function riverOf(flop: PfFlop, nodeId: number): { start: number; card: number } | null {
  for (const s of stepsTo(flop, nodeId)) if (s.node.riverStart) return { start: s.node.id, card: s.edge.kind };
  return null;
}
