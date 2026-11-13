/**
 * recordAnswer (REFACTOR_PLAN step 2-1): one place that makes the record of a practice answer, updates spaced
 * repetition and writes both. It must save exactly what Session.tsx and PostSession.tsx saved before it existed.
 *
 * `before*` below are the save code of the two screens as it was before step 2-1 (commit e7cd90e,
 * components/practice/Session.tsx `choose` and components/postflop/PostSession.tsx `choose`), copied with only the
 * React parts (refs, `round`, `q`, `j`) turned into arguments. Each case runs both on their own repository and
 * compares what is stored. A few values are also written out literally (taken from that old code), so a change
 * to the shared helpers (preflopRef, answerSrs, ...) that both would follow still shows.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classByName } from "../poker/hands";
import { decodeFlop } from "../postflop/decode";
import type { PfFlop } from "../postflop/decode";
import { PF_INDEX } from "../postflop/loader";
import type { Grade } from "../practice/grading";
import { answerSrs, postflopRef, preflopRef, withPosition } from "../practice/position";
import { recordAnswer } from "../practice/record";
import type { AnswerInput } from "../practice/record";
import { BOX_INTERVAL_MIN, SrsIndex } from "../practice/srs";
import type { SrsItem } from "../practice/srs";
import { solutionBuild } from "../solution/loader";
import { SEATS, spotType } from "../solution/tree";
import type { Manifest, SpotType } from "../solution/types";
import { MemoryRepo } from "../storage/memory";
import { buildStats, loadStats, STATS_CACHE_KEY } from "../storage/statsCache";
import type { StatsCache } from "../storage/statsCache";
import type { Attempt, Repo } from "../storage/types";
import { loadManifest, walk } from "./helpers";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const m = loadManifest();
const BUILD = solutionBuild(m.id);
const NODE = walk(m, "FFR"); // UTG, HJ fold, CO opens: the button faces an open
const AKS = classByName("AKs");
const SCENARIO = PF_INDEX.scenarios.find((s) => s.id === "srp-btn-bb")!;
const flop: PfFlop = {
  ...decodeFlop(new Uint8Array(gunzipSync(readFileSync(path.resolve(__dirname, "../../../public/postflop/srp-btn-bb/3.bin.gz"))))),
  build: PF_INDEX.build["srp-btn-bb/3"],
};
const decisions = flop.nodes.filter((n) => n.type === "decision" && n.data);
const FLOP_OOP = decisions.find((n) => n.street === 0 && n.actor === 0)!.id;
const FLOP_IP = decisions.find((n) => n.street === 0 && n.actor === 1)!.id;
const TURN = decisions.find((n) => n.street === 1)!.id;
const RIVER_IP = decisions.find((n) => n.street === 2 && n.actor === 1)!.id;

/** the parts of an answer the screens had at hand */
interface Raw {
  nodeId: number;
  hand: number;
  chosen: number;
  bestIndex: number;
  grade: Grade;
  evLoss: number;
  score: number;
  ms: number;
  roll: number | null;
  timeout: boolean;
  hint: boolean;
  sessionId: string;
  now: number;
}

// ------------------------------------------------- the save code before step 2-1 (see the comment at the top)

/** Session.tsx: `const ref = preflopRef(m, store.build, q.nodeId); const attempt = withPosition({...}, ref); ...` */
function beforePreflop(repo: Repo, srs: SrsIndex, mm: Manifest, storeBuild: string, mode: "spot" | "hand", r: Raw) {
  const meta = mm.nodes[r.nodeId];
  const now = r.now;
  const ref = preflopRef(mm, storeBuild, r.nodeId);
  const attempt = withPosition<Omit<Attempt, "pos" | "build">>({
    ts: now,
    sessionId: r.sessionId,
    mode,
    solution: mm.id,
    nodeId: r.nodeId,
    hand: r.hand,
    seat: meta.actor,
    spot: spotType(mm, r.nodeId),
    chosen: r.chosen,
    best: r.bestIndex,
    grade: r.grade,
    evLoss: r.evLoss,
    score: r.score,
    ms: r.ms,
    rng: r.roll !== null,
    timeout: r.timeout,
    hint: r.hint,
  }, ref);
  const item = answerSrs(srs, ref, r.nodeId, r.hand, r.grade, now);
  repo.addAttempt(attempt).catch(() => {});
  repo.putSrs(item).catch(() => {});
}

const STREET_SPOT: SpotType[] = ["postFlop", "postTurn", "postRiver"];
/** PostSession.tsx: `const seatName = node.actor === 0 ? sc.oop : sc.ip; const ref = postflopRef(...); ...` */
function beforePostflop(repo: Repo, srs: SrsIndex, sc: { id: string; oop: string; ip: string }, f: PfFlop, kind: "spot" | "through", r: Raw) {
  const node = f.nodes[r.nodeId];
  const now = r.now;
  const seatName = node.actor === 0 ? sc.oop : sc.ip;
  const ref = postflopRef(sc.id, f, r.nodeId);
  const attempt = withPosition<Omit<Attempt, "pos" | "build">>({
    ts: now,
    sessionId: r.sessionId,
    mode: kind === "spot" ? "postSpot" : "post",
    solution: ref.solution,
    nodeId: r.nodeId,
    hand: r.hand,
    seat: Math.max(0, SEATS.indexOf(seatName as (typeof SEATS)[number])),
    spot: STREET_SPOT[node.street],
    chosen: r.chosen,
    best: r.bestIndex,
    grade: r.grade,
    evLoss: r.evLoss,
    score: r.score,
    ms: r.ms,
    rng: r.roll !== null,
    timeout: r.timeout,
    hint: r.hint,
  }, ref);
  const item = answerSrs(srs, ref, r.nodeId, r.hand, r.grade, now);
  repo.addAttempt(attempt).catch(() => {});
  repo.putSrs(item).catch(() => {});
}

// ------------------------------------------------- the same answers through recordAnswer

const common = (srs: SrsIndex, r: Raw) => ({
  srs,
  sessionId: r.sessionId,
  nodeId: r.nodeId,
  hand: r.hand,
  chosen: r.chosen,
  best: r.bestIndex,
  grade: r.grade,
  evLoss: r.evLoss,
  score: r.score,
  ms: r.ms,
  rng: r.roll !== null,
  timeout: r.timeout,
  hint: r.hint,
  now: r.now,
});
const preInput = (srs: SrsIndex, mm: Manifest, storeBuild: string, mode: "spot" | "hand", r: Raw): AnswerInput => ({ game: "preflop", mode, manifest: mm, build: storeBuild, ...common(srs, r) });
const postInput = (srs: SrsIndex, sc: { id: string; oop: string; ip: string }, f: PfFlop, kind: "spot" | "through", r: Raw): AnswerInput => ({
  game: "postflop",
  mode: kind === "spot" ? "postSpot" : "post",
  scenario: sc,
  flop: f,
  ...common(srs, r),
});

const raw = (o: Partial<Raw> = {}): Raw => ({ nodeId: NODE, hand: AKS, chosen: 1, bestIndex: 2, grade: "best", evLoss: 0, score: 100, ms: 1234, roll: null, timeout: false, hint: false, sessionId: "s-abc", now: NOW, ...o });

/** the stored state of a repository, ids left out (MemoryRepo numbers them) */
async function stored(repo: Repo) {
  const attempts = (await repo.allAttempts()).map(({ id: _id, ...a }) => a);
  const srs = (await repo.allSrs()).sort((a, b) => a.key.localeCompare(b.key));
  return { attempts, srs };
}

type Step = { game: "pre"; mode: "spot" | "hand"; build?: string; r: Raw } | { game: "post"; kind: "spot" | "through"; r: Raw };

/** runs the same answers through the old code and through recordAnswer; both must store the same */
async function compare(steps: Step[], seed: SrsItem[] = []) {
  const oldRepo = new MemoryRepo();
  const newRepo = new MemoryRepo();
  for (const it of seed) {
    await oldRepo.putSrs(it);
    await newRepo.putSrs(it);
  }
  const oldIx = new SrsIndex(seed);
  const newIx = new SrsIndex(seed);
  const returned: SrsItem[] = [];
  for (const s of steps) {
    if (s.game === "pre") {
      beforePreflop(oldRepo, oldIx, m, s.build ?? BUILD, s.mode, s.r);
      returned.push(await recordAnswer(newRepo, preInput(newIx, m, s.build ?? BUILD, s.mode, s.r)));
    } else {
      beforePostflop(oldRepo, oldIx, SCENARIO, flop, s.kind, s.r);
      returned.push(await recordAnswer(newRepo, postInput(newIx, SCENARIO, flop, s.kind, s.r)));
    }
  }
  const before = await stored(oldRepo);
  const after = await stored(newRepo);
  expect(after).toEqual(before);
  return { before, after, returned, newIx };
}

describe("recordAnswer saves what the pre-flop screen saved", () => {
  it("one answer (spot mode): the Attempt and the new SrsItem, field by field", async () => {
    const { after, returned } = await compare([{ game: "pre", mode: "spot", r: raw() }]);
    // literal: what the old code stored for this answer
    expect(after.attempts).toEqual([
      { ts: NOW, sessionId: "s-abc", mode: "spot", solution: "cash6max-100bb", nodeId: NODE, hand: AKS, seat: 3, spot: "vsOpen", chosen: 1, best: 2, grade: "best", evLoss: 0, score: 100, ms: 1234, rng: false, timeout: false, hint: false, pos: "F-F-R2.5", build: BUILD },
    ]);
    expect(after.srs).toEqual([
      { key: `k:cash6max-100bb:F-F-R2.5:${AKS}`, nodeId: NODE, hand: AKS, solution: "cash6max-100bb", pos: "F-F-R2.5", build: BUILD, box: 1, due: NOW + 10 * MIN, seen: 1, lapses: 0, lastGrade: "best", updated: NOW },
    ]);
    expect(returned).toEqual(after.srs);
  });

  it("hand mode with RNG, a timeout and a hint; no build ID", async () => {
    const { after } = await compare([{ game: "pre", mode: "hand", build: "", r: raw({ nodeId: 0, hand: 0, roll: 0.42, timeout: true, hint: true, grade: "blunder", evLoss: 1.5, score: 0, chosen: 0, bestIndex: 2 }) }]);
    expect(after.attempts[0]).toMatchObject({ mode: "hand", nodeId: 0, pos: "root", seat: 0, spot: "rfi", rng: true, timeout: true, hint: true, grade: "blunder", evLoss: 1.5, score: 0 });
    expect(after.attempts[0]).not.toHaveProperty("build");
    expect(after.srs[0]).not.toHaveProperty("build");
    expect(after.srs[0]).toMatchObject({ box: 0, lapses: 1, seen: 1, due: NOW });
  });

  it("every grade, one after another on the same (position, hand): the boxes go up and back to 0", async () => {
    const grades: Grade[] = ["best", "correct", "correct", "inaccurate", "best", "mistake", "correct", "blunder"];
    const steps: Step[] = grades.map((grade, k) => ({ game: "pre", mode: k % 2 ? "hand" : "spot", r: raw({ grade, now: NOW + k * 3_600_000, ms: 500 + k, hint: k === 4, roll: k === 6 ? 0.1 : null }) }));
    const { after, returned } = await compare(steps);
    expect(after.attempts).toHaveLength(grades.length);
    expect(after.srs).toHaveLength(1);
    // literal: box after each answer (1, 2, 3, 0, 1, 0, 1, 0) as the old code made them
    expect(returned.map((s) => s.box)).toEqual([1, 2, 3, 0, 1, 0, 1, 0]);
    expect(returned.map((s) => s.lapses)).toEqual([0, 0, 0, 1, 1, 2, 2, 3]);
    expect(after.srs[0]).toMatchObject({ seen: 8, lapses: 3, box: 0, lastGrade: "blunder", updated: NOW + 7 * 3_600_000, due: NOW + 7 * 3_600_000 });
    expect(returned[2].due).toBe(NOW + 2 * 3_600_000 + BOX_INTERVAL_MIN[3] * MIN);
  });

  it("an item that was already on the device keeps its key and gets the node id and build of this answer", async () => {
    const seed: SrsItem = { key: `k:cash6max-100bb:F-F-R2.5:${AKS}`, nodeId: 999, hand: AKS, solution: "cash6max-100bb", pos: "F-F-R2.5", build: "old000000000", box: 4, due: NOW - 1, seen: 9, lapses: 2, lastGrade: "correct", updated: NOW - 5 * MIN };
    const { after } = await compare([{ game: "pre", mode: "spot", r: raw({ grade: "correct" }) }], [seed]);
    expect(after.srs).toEqual([{ ...seed, nodeId: NODE, build: BUILD, box: 5, seen: 10, due: NOW + BOX_INTERVAL_MIN[5] * MIN, updated: NOW }]);
  });
});

describe("recordAnswer saves what the post-flop screen saved", () => {
  it("spot mode on the turn: the Attempt and the new SrsItem, field by field", async () => {
    const combo = flop.nodes[TURN].data!.hands[0];
    const { after } = await compare([{ game: "post", kind: "spot", r: raw({ nodeId: TURN, hand: combo, grade: "inaccurate", evLoss: 0.1, score: 55 }) }]);
    // literal: what the old code stored for this answer (the turn decision is the out-of-position player's: BB)
    expect(after.attempts).toEqual([
      { ts: NOW, sessionId: "s-abc", mode: "postSpot", solution: "post:srp-btn-bb", nodeId: TURN, hand: combo, seat: 5, spot: "postTurn", chosen: 1, best: 2, grade: "inaccurate", evLoss: 0.1, score: 55, ms: 1234, rng: false, timeout: false, hint: false, pos: "9s6d3c@X-X/Ad", build: "fd91cfc9e86b" },
    ]);
    expect(after.srs).toEqual([
      { key: `k:post:srp-btn-bb:9s6d3c@X-X/Ad:${combo}`, nodeId: TURN, hand: combo, solution: "post:srp-btn-bb", pos: "9s6d3c@X-X/Ad", build: "fd91cfc9e86b", box: 0, due: NOW, seen: 1, lapses: 1, lastGrade: "inaccurate", updated: NOW },
    ]);
  });

  it("a hand played through: flop (OOP, IP), turn and river answers, the seats and streets of each", async () => {
    const combo = 1325;
    const nodes = [FLOP_OOP, FLOP_IP, TURN, RIVER_IP];
    const steps: Step[] = nodes.map((nodeId, k) => ({ game: "post", kind: "through", r: raw({ nodeId, hand: combo, grade: k === 2 ? "mistake" : "best", now: NOW + k * 1000, roll: k === 1 ? 0.7 : null, timeout: k === 3, hint: k === 0 }) }));
    const { after } = await compare(steps);
    expect(after.attempts.map((a) => [a.mode, a.seat, a.spot, a.rng, a.timeout, a.hint])).toEqual([
      ["post", 5, "postFlop", false, false, true],
      ["post", 3, "postFlop", true, false, false],
      ["post", 5, "postTurn", false, false, false],
      ["post", 3, "postRiver", false, true, false],
    ]);
    expect(after.attempts.every((a) => a.sessionId === "s-abc" && a.solution === "post:srp-btn-bb" && a.build === "fd91cfc9e86b")).toBe(true);
    expect(after.srs).toHaveLength(4);
  });

  it("a seat name the table does not know is seat 0 (as before)", async () => {
    const oldRepo = new MemoryRepo();
    const newRepo = new MemoryRepo();
    const odd = { id: SCENARIO.id, oop: "XX", ip: "BTN" };
    beforePostflop(oldRepo, new SrsIndex(), odd, flop, "spot", raw({ nodeId: FLOP_OOP, hand: 7 }));
    await recordAnswer(newRepo, postInput(new SrsIndex(), odd, flop, "spot", raw({ nodeId: FLOP_OOP, hand: 7 })));
    expect(await stored(newRepo)).toEqual(await stored(oldRepo));
    expect((await newRepo.allAttempts())[0].seat).toBe(0);
  });
});

describe("recordAnswer: the in-memory index, the writes and their order", () => {
  /** a repository that logs the calls when they are made and finishes the writes only when told */
  function slowRepo() {
    const calls: string[] = [];
    const done: (() => void)[] = [];
    const repo = new MemoryRepo();
    const wait = <T>(name: string, write: () => Promise<T>) => {
      calls.push(name);
      return new Promise<void>((res) => done.push(() => void write().then(() => res())));
    };
    const r = Object.assign(Object.create(repo) as MemoryRepo, {
      addAttempt: (a: Attempt) => wait("addAttempt", () => repo.addAttempt(a)),
      putSrs: (s: SrsItem) => wait("putSrs", () => repo.putSrs(s)),
    });
    return { repo: r, inner: repo, calls, finish: () => done.splice(0).forEach((f) => f()) };
  }

  it("the index has the new item before the writes are done; each record is written once, Attempt first", async () => {
    const { repo, inner, calls, finish } = slowRepo();
    const ix = new SrsIndex();
    let settled = false;
    const p = recordAnswer(repo, preInput(ix, m, BUILD, "spot", raw())).then((it) => {
      settled = true;
      return it;
    });
    // synchronously, before anything is written
    expect(ix.find(m.id, "F-F-R2.5", AKS)).toMatchObject({ box: 1, seen: 1 });
    expect(calls).toEqual(["addAttempt", "putSrs"]);
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    const item = await p;
    expect(item).toBe(ix.find(m.id, "F-F-R2.5", AKS));
    expect(calls).toEqual(["addAttempt", "putSrs"]);
    expect(await inner.allAttempts()).toHaveLength(1);
    expect(await inner.allSrs()).toEqual([item]);
  });

  it("the stats totals take each record in (REFACTOR_PLAN step 2-7); a totals write that fails does not fail the answer", async () => {
    const repo = new MemoryRepo();
    const ix = new SrsIndex();
    await recordAnswer(repo, preInput(ix, m, BUILD, "spot", raw()));
    await recordAnswer(repo, postInput(ix, SCENARIO, flop, "spot", raw({ nodeId: TURN, hand: 3, grade: "mistake", evLoss: 0.4, score: 50, now: NOW + 1 })));
    expect(await repo.getMeta(STATS_CACHE_KEY)).toEqual(buildStats(await repo.allAttempts()));
    expect(await repo.getMeta<StatsCache>(STATS_CACHE_KEY)).toMatchObject({ n: 2, lastId: 2 });

    const failing = Object.assign(Object.create(repo) as MemoryRepo, { setMeta: () => Promise.reject(new Error("quota")) });
    await expect(recordAnswer(failing, preInput(ix, m, BUILD, "hand", raw({ now: NOW + 2 })))).resolves.toBeDefined();
    expect(await repo.countAttempts()).toBe(3);
    // the next read catches up
    expect((await loadStats(repo)).n).toBe(3);
  });

  it("a failed write rejects the promise; the index still has the answer and the other write is still made", async () => {
    const inner = new MemoryRepo();
    const repo = Object.assign(Object.create(inner) as MemoryRepo, { addAttempt: () => Promise.reject(new Error("quota")) });
    const ix = new SrsIndex();
    await expect(recordAnswer(repo, postInput(ix, SCENARIO, flop, "spot", raw({ nodeId: TURN, hand: 3 })))).rejects.toThrow("quota");
    expect(ix.find("post:srp-btn-bb", "9s6d3c@X-X/Ad", 3)).toBeDefined();
    expect(await inner.allSrs()).toHaveLength(1);
  });
});
