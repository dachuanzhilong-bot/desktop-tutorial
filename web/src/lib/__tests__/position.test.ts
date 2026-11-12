/**
 * Records that carry a position key and a build ID (REFACTOR_PLAN step 1-3).
 * New records get `pos` and `build`; readers look the node (and the flop) up again from `pos`, so a record stays
 * on its position when the data is generated again with other node ids and another flop order; records made
 * before position keys (no `pos`) are read as they always were.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { practiceItems } from "../analyze/aggregate";
import { analyzeHand } from "../analyze/match";
import { normalizeHand } from "../analyze/normalize";
import { parseHandHistory } from "../analyze/parse";
import { classByName } from "../poker/hands";
import { decodeFlop } from "../postflop/decode";
import type { PfFlop } from "../postflop/decode";
import { PF_INDEX } from "../postflop/loader";
import { flopKey, postflopKey } from "../postflop/positionKey";
import { legacyPostSrsKey } from "../postflop/practice";
import { answerSrs, currentFlopIndex, currentPostflopNode, currentPreflopNode, flopIndexOf, parsePostSolution, postflopRef, preflopRef, splitPostflopPos, withPosition } from "../practice/position";
import { dueReview, resolveItems } from "../practice/review";
import { DEFAULT_FILTER, pickHand } from "../practice/sampler";
import { posSrsKey, srsKey, SrsIndex, updateSrs } from "../practice/srs";
import type { SrsItem } from "../practice/srs";
import { solutionBuild } from "../solution/loader";
import { preflopKey } from "../solution/positionKey";
import { MemoryRepo } from "../storage/memory";
import { recentMistakes, resolveStudyHref, studyHref } from "../storage/mistakes";
import type { StudySources } from "../storage/mistakes";
import { heatmap, summarize } from "../storage/stats";
import type { Attempt, ExportBlob, StoredHand } from "../storage/types";
import { postflopLink, preflopLink } from "../study/links";
import { mulberry32 } from "../util/rng";
import { H_BAD_3BET } from "./fixtures/hands";
import { renumberFlop, renumberManifest } from "./fixtures/renumber";
import { loadManifest, loadManifestFor, loadNode, walk } from "./helpers";

const NOW = 1_800_000_000_000;
const SOL = "cash6max-100bb";
const SCENARIO = "srp-btn-bb";
const FLOP = 3; // "9s 6d 3c"

const m = loadManifest();
const renumbered = renumberManifest(m);
/** a decision a few actions deep: its id changes in the renumbered manifest */
const NODE = walk(m, "FFR");
const HAND = classByName("AKs");

const readFlop = (scenario: string, index: number): PfFlop => ({
  ...decodeFlop(new Uint8Array(gunzipSync(readFileSync(path.resolve(__dirname, `../../../public/postflop/${scenario}/${index}.bin.gz`))))),
  build: PF_INDEX.build[`${scenario}/${index}`],
});
const flop = readFlop(SCENARIO, FLOP);
const flopRenumbered = renumberFlop(flop);
/** a turn decision: a line with a card in it */
const POST_NODE = flop.nodes.find((n) => n.type === "decision" && n.street === 1 && n.data)!.id;
const COMBO = flop.nodes[POST_NODE].data!.hands[0];

const att = (o: Partial<Attempt> = {}): Attempt => ({ ts: 1, sessionId: "s", mode: "spot", solution: SOL, nodeId: 0, hand: 0, seat: 0, spot: "rfi", chosen: 0, best: 1, grade: "mistake", evLoss: 0.4, score: 20, ms: 900, rng: false, timeout: false, hint: false, ...o });
/** what the practice screens save for an answer at (node, hand) of manifest `man` */
const preAttempt = (man: typeof m, build: string, nodeId: number, hand: number, o: Partial<Attempt> = {}) => withPosition(att({ solution: man.id, nodeId, hand, ...o }), preflopRef(man, build, nodeId));
const postAttempt = (f: PfFlop, nodeId: number, combo: number, o: Partial<Attempt> = {}) => {
  const ref = postflopRef(SCENARIO, f, nodeId);
  return withPosition(att({ mode: "postSpot", solution: ref.solution, nodeId, hand: combo, spot: "postTurn", seat: 5, ...o }), ref);
};

/** today's data as the Study links see it */
const sources = (o: Partial<StudySources> = {}): StudySources => ({
  manifest: async (id) => {
    if (id !== m.id) throw new Error(`no solution ${id}`);
    return m;
  },
  flops: PF_INDEX.flops,
  flop: async (scenario, index) => readFlop(scenario, index),
  ...o,
});

describe("new records carry a position key and a build ID", () => {
  it("pre-flop: the action line and the build of the solution", () => {
    const build = solutionBuild(SOL);
    expect(build).toMatch(/^[0-9a-f]{12}$/);
    const ref = preflopRef(m, build, NODE);
    expect(ref).toEqual({ solution: SOL, pos: preflopKey(m, NODE), build });
    expect(ref.pos).toMatch(/^F-F-R\d/);
    expect(preflopRef(m, build, 0).pos).toBe("root");

    const a = preAttempt(m, build, NODE, HAND);
    expect(a.pos).toBe(ref.pos);
    expect(a.build).toBe(build);
    // nothing else changes: the node id is still written (old readers, the duplicate check of sync and import)
    expect(a).toEqual({ ...att({ nodeId: NODE, hand: HAND }), pos: ref.pos, build });
    // every depth the same way
    const m40 = loadManifestFor(40);
    expect(preflopRef(m40, solutionBuild(m40.id), 0)).toEqual({ solution: "cash6max-40bb", pos: "root", build: solutionBuild("cash6max-40bb") });
    // a solution without a build ID (not in the index): the record has the position, no empty build
    expect(preflopRef(m, "", NODE)).toEqual({ solution: SOL, pos: ref.pos });
    expect("build" in withPosition(att(), preflopRef(m, "", NODE))).toBe(false);
  });

  it("post-flop: the flop's board and the line, a solution id without the flop's index, the build of the flop file", () => {
    const ref = postflopRef(SCENARIO, flop, POST_NODE);
    expect(ref.solution).toBe("post:srp-btn-bb");
    expect(ref.pos).toBe(`9s6d3c@${postflopKey(flop, POST_NODE)}`);
    expect(ref.pos).toMatch(/^9s6d3c@[^@]+\/[2-9TJQKA][cdhs]/); // a turn card in the line
    expect(ref.build).toBe(PF_INDEX.build[`${SCENARIO}/${FLOP}`]);
    expect(ref.build).toMatch(/^[0-9a-f]{12}$/);
    expect(postflopRef(SCENARIO, flop, 0).pos).toBe("9s6d3c@root");

    const a = postAttempt(flop, POST_NODE, COMBO);
    expect(a).toMatchObject({ solution: "post:srp-btn-bb", pos: ref.pos, build: ref.build, nodeId: POST_NODE, hand: COMBO });
    // a flop solved on the device has no build ID
    expect(postflopRef(SCENARIO, { ...flop, build: undefined }, 0)).toEqual({ solution: "post:srp-btn-bb", pos: "9s6d3c@root" });
  });

  it("the parts of a post-flop position and solution id are read back; anything else is refused", () => {
    expect(splitPostflopPos("9s6d3c@X-B1.75-C/Td")).toEqual({ flop: "9s6d3c", line: "X-B1.75-C/Td" });
    for (const bad of ["", "@", "9s6d3c@", "@root", "9s6d3c", "a@b@c", "F-F-R2.5"]) expect(splitPostflopPos(bad)).toBeNull();
    expect(parsePostSolution("post:srp-btn-bb")).toEqual({ scenario: "srp-btn-bb", flopIndex: null });
    expect(parsePostSolution("post:srp-btn-bb/3")).toEqual({ scenario: "srp-btn-bb", flopIndex: 3 }); // records made before position keys
    for (const bad of ["", "post:", "cash6max-100bb", "post:a/b", "post:a/1/2"]) expect(parsePostSolution(bad)).toBeNull();
    // the flop is found by its board, whatever the order of its cards in the index
    expect(flopIndexOf(PF_INDEX.flops, "9s6d3c")).toBe(FLOP);
    expect(flopIndexOf(["3c 9s 6d"], "9s6d3c")).toBe(0);
    expect(flopIndexOf(PF_INDEX.flops, "AsAhAd")).toBe(-1);
    PF_INDEX.flops.forEach((text, i) => expect(flopIndexOf(PF_INDEX.flops, flopKey(readFlop(SCENARIO, i).board))).toBe(i));
  });

  it("an analysed hand: every decision has its position key, the analysis its build ID", async () => {
    const parsed = normalizeHand(parseHandHistory(H_BAD_3BET).hands[0]);
    if ("reason" in parsed) throw new Error(parsed.reason);
    const node = async (id: number) => loadNode(m, id);
    const a = await analyzeHand({ manifest: m, build: "abc123abc123", node }, parsed);
    expect(a.build).toBe("abc123abc123");
    expect(a.decisions).toHaveLength(1);
    expect(a.decisions[0].pos).toBe(preflopKey(m, a.decisions[0].nodeId));
    expect(a.worst?.pos).toBe(a.decisions[0].pos);
    expect("build" in (await analyzeHand({ manifest: m, node }, parsed))).toBe(false);

    // the practice set made from it asks the position, and finds it in data with other node ids
    const stored: StoredHand = { id: parsed.id, site: "x", ts: 1, importedAt: 2, hand: parsed, analysis: a };
    const items = practiceItems([stored]);
    expect(items).toEqual([{ nodeId: a.decisions[0].nodeId, hand: a.decisions[0].handClass, pos: a.decisions[0].pos }]);
    expect(resolveItems(renumbered.m, items)).toEqual([{ nodeId: renumbered.map(a.decisions[0].nodeId), hand: a.decisions[0].handClass }]);
    // an analysis made before position keys: the node id as it is
    const old: StoredHand = { ...stored, analysis: { ...a, decisions: a.decisions.map(({ pos: _pos, ...d }) => d) } };
    expect(practiceItems([old])).toEqual([{ nodeId: a.decisions[0].nodeId, hand: a.decisions[0].handClass }]);
  });
});

describe("spaced repetition by position", () => {
  it("a new item has the key k:<solution>:<pos>:<hand> (no node id) at every depth, and is updated in place", () => {
    const index = new SrsIndex();
    const ref = preflopRef(m, "b1", NODE);
    const first = answerSrs(index, ref, srsKey(SOL, NODE, HAND), NODE, HAND, "mistake", NOW);
    expect(first).toMatchObject({ key: `k:${SOL}:${ref.pos}:${HAND}`, solution: SOL, pos: ref.pos, build: "b1", nodeId: NODE, hand: HAND, seen: 1, lapses: 1, box: 0 });
    expect(first.key).toBe(posSrsKey(SOL, ref.pos, HAND));
    expect(first.key).not.toContain(`:${NODE}:`);

    // the same position in data generated again (other node id, other build): the same item
    const again = preflopRef(renumbered.m, "b2", renumbered.map(NODE));
    expect(again.pos).toBe(ref.pos);
    const second = answerSrs(index, again, srsKey(SOL, renumbered.map(NODE), HAND), renumbered.map(NODE), HAND, "best", NOW + 1000);
    expect(second).toMatchObject({ key: first.key, seen: 2, lapses: 1, box: 1, nodeId: renumbered.map(NODE), build: "b2", pos: ref.pos, solution: SOL });

    const m40 = loadManifestFor(40);
    expect(answerSrs(new SrsIndex(), preflopRef(m40, "", 0), srsKey(m40.id, 0, 3), 0, 3, "best", NOW).key).toBe("k:cash6max-40bb:root:3");
    const post = postflopRef(SCENARIO, flop, POST_NODE);
    const p = answerSrs(new SrsIndex(), post, legacyPostSrsKey(SCENARIO, FLOP, POST_NODE, COMBO), POST_NODE, COMBO, "blunder", NOW);
    expect(p).toMatchObject({ key: `k:post:srp-btn-bb:${post.pos}:${COMBO}`, solution: "post:srp-btn-bb", pos: post.pos, hand: COMBO });
    expect(p.key).not.toContain(`/${FLOP}:`); // no flop index
  });

  it("an item made before position keys keeps its key and gets no position", () => {
    const old100: SrsItem = { key: `${NODE}:${HAND}`, nodeId: NODE, hand: HAND, box: 2, due: NOW, seen: 3, lapses: 1, lastGrade: "best", updated: NOW - 1 };
    const old40: SrsItem = { ...old100, key: `cash6max-40bb:0:${HAND}`, nodeId: 0 };
    const oldPost: SrsItem = { ...old100, key: `p:${SCENARIO}/${FLOP}:${POST_NODE}:${COMBO}`, nodeId: POST_NODE, hand: COMBO };
    const index = new SrsIndex([old100, old40, oldPost]);

    const a = answerSrs(index, preflopRef(m, "b1", NODE), srsKey(SOL, NODE, HAND), NODE, HAND, "best", NOW);
    expect(a).toEqual({ ...old100, box: 3, seen: 4, due: a.due, updated: NOW });
    const m40 = loadManifestFor(40);
    const b = answerSrs(index, preflopRef(m40, "b1", 0), srsKey(m40.id, 0, HAND), 0, HAND, "mistake", NOW);
    expect(b).toMatchObject({ key: old40.key, seen: 4, lapses: 2, box: 0 });
    const c = answerSrs(index, postflopRef(SCENARIO, flop, POST_NODE), legacyPostSrsKey(SCENARIO, FLOP, POST_NODE, COMBO), POST_NODE, COMBO, "best", NOW);
    expect(c).toMatchObject({ key: oldPost.key, seen: 4 });
    for (const it of [a, b, c]) {
      expect("pos" in it).toBe(false);
      expect("solution" in it).toBe(false);
    }
    // the updated item is the one the index hands out next time
    expect(index.find(SOL, preflopKey(m, NODE), HAND, srsKey(SOL, NODE, HAND))).toBe(a);
  });

  it("the lookup is by (solution, position, hand): a new item is never found by a key string or a node id", () => {
    const ref = preflopRef(m, "b1", NODE);
    const item = updateSrs(undefined, NODE, HAND, "mistake", NOW, undefined, ref);
    const index = new SrsIndex([item]);
    expect(index.find(SOL, ref.pos, HAND)).toBe(item);
    expect(index.find(SOL, ref.pos, HAND + 1)).toBeUndefined();
    expect(index.find("cash6max-40bb", ref.pos, HAND)).toBeUndefined(); // the same line at another depth is another decision
    expect(index.find(SOL, "root", HAND, item.key)).toBeUndefined(); // not by its own key string
    // after the data is generated again the node with the old id is another position: the item is not there ...
    const other = preflopKey(renumbered.m, NODE);
    expect(other).not.toBe(ref.pos);
    expect(index.find(SOL, other, HAND, srsKey(SOL, NODE, HAND))).toBeUndefined();
    // ... it is at the node the position has now
    expect(index.find(SOL, preflopKey(renumbered.m, renumbered.map(NODE)), HAND)).toBe(item);
    // an old item is found by its old key only
    const old: SrsItem = { key: "7:9", nodeId: 7, hand: 9, box: 0, due: NOW, seen: 1, lapses: 1, lastGrade: "mistake", updated: NOW };
    index.put(old);
    expect(index.find(SOL, "anything", 9, "7:9")).toBe(old);
    expect(index.find(SOL, "anything", 9)).toBeUndefined();
  });

  it("the sampler asks a missed hand more often when it is given the lookup by position", () => {
    const sol = loadNode(m, 0);
    const missed = classByName("Q4o");
    const control = classByName("J4o");
    // the item was made when the root had another node id (999): only its position says where it belongs
    const item = updateSrs(undefined, 999, missed, "blunder", NOW - 60_000, undefined, { solution: SOL, pos: "root" });
    const index = new SrsIndex([item]);
    const ratio = (srs: Parameters<typeof pickHand>[4]) => {
      const rnd = mulberry32(7);
      const c = new Map<number, number>();
      for (let i = 0; i < 30_000; i++) {
        const h = pickHand(sol, 0, DEFAULT_FILTER, rnd, srs, NOW, SOL);
        c.set(h, (c.get(h) ?? 0) + 1);
      }
      return (c.get(missed) ?? 0) / (c.get(control) ?? 1);
    };
    expect(ratio((h) => index.find(SOL, preflopKey(m, 0), h, srsKey(SOL, 0, h)))).toBeGreaterThan(4);
    // by key strings (how it was looked up before) the item is not found: both hands are asked equally often
    const byKey = ratio(new Map([[item.key, item]]));
    expect(byKey).toBeGreaterThan(0.85);
    expect(byKey).toBeLessThan(1.15);
  });
});

describe("a record with a position key stays on its position when the node ids change", () => {
  const again = sources({ manifest: async () => renumbered.m });

  it("pre-flop: the Study link goes to the node the position has in the new manifest", async () => {
    const a = preAttempt(m, "b1", NODE, HAND);
    expect(renumbered.map(NODE)).not.toBe(NODE);
    expect(await resolveStudyHref(a, sources())).toBe(preflopLink(100, NODE, HAND));
    const href = await resolveStudyHref(a, again);
    expect(href).toBe(preflopLink(100, renumbered.map(NODE), HAND));
    expect(href).not.toBe(preflopLink(100, NODE, HAND));
    // it is the same position: the same line of actions leads there
    expect(preflopKey(renumbered.m, renumbered.map(NODE))).toBe(a.pos);
    expect(currentPreflopNode(renumbered.m, a)).toBe(renumbered.map(NODE));
    // the link without today's data is not offered for such a record (its node id may be out of date)
    expect(studyHref(a)).toBeNull();
  });

  it("a record made before position keys is read as before: by its node id", async () => {
    const old = att({ nodeId: NODE, hand: HAND });
    expect(await resolveStudyHref(old, again)).toBe(preflopLink(100, NODE, HAND));
    expect(studyHref(old)).toBe(preflopLink(100, NODE, HAND));
    expect(currentPreflopNode(renumbered.m, old)).toBe(NODE);
    const oldPost = att({ mode: "postSpot", solution: `post:${SCENARIO}/${FLOP}`, nodeId: POST_NODE, hand: COMBO });
    expect(await resolveStudyHref(oldPost, again)).toBe(postflopLink(SCENARIO, FLOP, POST_NODE));
    expect(currentFlopIndex(PF_INDEX.flops, oldPost)).toEqual({ scenario: SCENARIO, flopIndex: FLOP });
    expect(currentPostflopNode(flopRenumbered.f, oldPost)).toBe(POST_NODE);
  });

  it("post-flop: the link follows the flop to its new index and the line to its new node", async () => {
    const a = postAttempt(flop, POST_NODE, COMBO);
    expect(await resolveStudyHref(a, sources())).toBe(postflopLink(SCENARIO, FLOP, POST_NODE));

    // generated again: the flops in another order (and their cards written in another order), other node ids
    const flops = [...PF_INDEX.flops].reverse().map((text) => text.split(" ").reverse().join(" "));
    const newIndex = flops.length - 1 - FLOP;
    expect(newIndex).not.toBe(FLOP);
    expect(flopRenumbered.map(POST_NODE)).not.toBe(POST_NODE);
    const asked: string[] = [];
    const src = sources({
      flops,
      flop: async (scenario, index) => {
        asked.push(`${scenario}/${index}`);
        if (index !== newIndex) throw new Error("another flop");
        return flopRenumbered.f;
      },
    });
    expect(await resolveStudyHref(a, src)).toBe(postflopLink(SCENARIO, newIndex, flopRenumbered.map(POST_NODE)));
    expect(asked).toEqual([`${SCENARIO}/${newIndex}`]);
    expect(postflopKey(flopRenumbered.f, flopRenumbered.map(POST_NODE))).toBe(splitPostflopPos(a.pos)!.line);
    expect(currentFlopIndex(flops, a)).toEqual({ scenario: SCENARIO, flopIndex: newIndex });
    // the line is only looked up in its own flop
    expect(currentPostflopNode(readFlop(SCENARIO, 0), a)).toBeNull();
  });

  it("a position today's data does not have: no link, but the record still counts", async () => {
    const gone = [
      att({ pos: "F-F-R999", build: "old", nodeId: NODE, hand: HAND }), // a raise size the solution does not have any more
      att({ pos: "not a key", nodeId: 0 }),
      att({ solution: "cash6max-55bb", pos: "root" }), // a depth that is not shipped
      att({ mode: "postSpot", solution: "post:srp-btn-bb", pos: "AsAhAd@root", nodeId: 0, hand: COMBO, ts: 2 }), // a flop that is not solved
      att({ mode: "postSpot", solution: "post:srp-btn-bb", pos: "9s6d3c@X-B999", nodeId: 5, hand: COMBO, ts: 3 }),
      att({ mode: "postSpot", solution: "post:srp-btn-bb", pos: "9s6d3c", nodeId: 5, hand: COMBO, ts: 4 }),
    ];
    for (const a of gone) expect(await resolveStudyHref(a, sources())).toBeNull();
    // data that cannot be loaded (offline): no link either, never an exception
    const offline = sources({ manifest: () => Promise.reject(new Error("offline")), flop: () => Promise.reject(new Error("offline")) });
    expect(await resolveStudyHref(preAttempt(m, "b", NODE, HAND), offline)).toBeNull();
    expect(await resolveStudyHref(postAttempt(flop, POST_NODE, COMBO), offline)).toBeNull();

    expect(summarize(gone)).toMatchObject({ n: gone.length, accuracy: 0 });
    expect(heatmap(gone).reduce((s, c) => s + c.n, 0)).toBe(gone.length);
    expect(recentMistakes(gone, 20)).toHaveLength(gone.length);
  });

  it("the mistake notebook keeps one entry per position: the same position under two node ids is one entry", () => {
    const before = preAttempt(m, "b1", NODE, HAND, { ts: 5 });
    const after = preAttempt(renumbered.m, "b2", renumbered.map(NODE), HAND, { ts: 9 });
    expect(after.nodeId).not.toBe(before.nodeId);
    expect(recentMistakes([before, after]).map((a) => a.ts)).toEqual([9]);
    // the same node id, another position (the id was reused): two entries
    const reused = preAttempt(renumbered.m, "b2", NODE, HAND, { ts: 7 });
    expect(reused.pos).not.toBe(before.pos);
    expect(recentMistakes([before, reused]).map((a) => a.ts)).toEqual([7, 5]);
  });

  it("the review queue takes new items in and asks them at the node their position has now", () => {
    const fresh = (nodeId: number, hand: number, over: Partial<SrsItem> = {}) => ({ ...updateSrs(undefined, nodeId, hand, "mistake", NOW - 5000, undefined, preflopRef(m, "b1", nodeId)), due: NOW - 1000, ...over });
    const postItem = { ...updateSrs(undefined, POST_NODE, COMBO, "mistake", NOW - 5000, undefined, postflopRef(SCENARIO, flop, POST_NODE)), due: NOW - 1000 };
    const old: SrsItem = { key: "0:5", nodeId: 0, hand: 5, box: 1, due: NOW - 500, seen: 1, lapses: 0, lastGrade: "mistake", updated: NOW - 5000 };
    const q = dueReview(
      [
        fresh(NODE, HAND),
        fresh(0, 3, { due: NOW - 2000 }),
        fresh(0, 4, { due: NOW + 60_000 }), // not due yet
        { ...fresh(0, 6), solution: "cash6max-40bb", key: "k:cash6max-40bb:root:6" },
        postItem, // post-flop: not part of this review
        old,
      ],
      NOW,
    );
    expect(q.total).toBe(4);
    expect(q.groups.map((g) => [g.solution, g.due])).toEqual([[SOL, 3], ["cash6max-40bb", 1]]);
    expect(q.groups[0].items).toEqual([{ nodeId: 0, hand: 3, pos: "root" }, { nodeId: NODE, hand: HAND, pos: preflopKey(m, NODE) }, { nodeId: 0, hand: 5 }]);

    // the round in today's data, and in data generated again
    expect(resolveItems(m, q.groups[0].items)).toEqual([{ nodeId: 0, hand: 3 }, { nodeId: NODE, hand: HAND }, { nodeId: 0, hand: 5 }]);
    expect(resolveItems(renumbered.m, q.groups[0].items)).toEqual([{ nodeId: 0, hand: 3 }, { nodeId: renumbered.map(NODE), hand: HAND }, { nodeId: 0, hand: 5 }]);
    // a position the data does not have is not asked
    expect(resolveItems(m, [{ nodeId: 3, hand: 1, pos: "F-F-R999" }, { nodeId: 0, hand: 2, pos: "root" }])).toEqual([{ nodeId: 0, hand: 2 }]);
    expect(resolveItems(m, [{ nodeId: 3, hand: 1, pos: "F-F-R999" }])).toEqual([]);
  });
});

describe("backups", () => {
  /** a backup file written before position keys existed, as it is on disk (JSON) */
  const OLD_BACKUP = JSON.stringify({
    app: "tessera",
    version: 1,
    exportedAt: 1_700_000_100_000,
    attempts: [
      { id: 1, ts: 1_700_000_000_000, sessionId: "old", mode: "spot", solution: "cash6max-100bb", nodeId: 3, hand: 5, seat: 3, spot: "rfi", chosen: 1, best: 0, grade: "mistake", evLoss: 0.3, score: 30, ms: 800, rng: false, timeout: false, hint: false },
      { id: 2, ts: 1_700_000_001_000, sessionId: "old", mode: "postSpot", solution: "post:srp-btn-bb/3", nodeId: 40, hand: 1325, seat: 5, spot: "postFlop", chosen: 1, best: 0, grade: "blunder", evLoss: 1.5, score: 0, ms: 800, rng: false, timeout: false, hint: false },
    ],
    srs: [
      { key: "3:5", nodeId: 3, hand: 5, box: 0, due: 0, seen: 3, lapses: 1, lastGrade: "mistake", updated: 1_700_000_000_000 },
      { key: "cash6max-40bb:7:9", nodeId: 7, hand: 9, box: 1, due: 0, seen: 1, lapses: 0, lastGrade: "best", updated: 1_700_000_000_000 },
      { key: "p:srp-btn-bb/3:40:1325", nodeId: 40, hand: 1325, box: 0, due: 0, seen: 1, lapses: 1, lastGrade: "blunder", updated: 1_700_000_001_000 },
    ],
    meta: {},
  });

  it("an old backup (no pos, no build) is read, and its records work as before", async () => {
    const repo = new MemoryRepo();
    await repo.importAll(JSON.parse(OLD_BACKUP) as ExportBlob);
    const attempts = await repo.allAttempts();
    expect(attempts).toHaveLength(2);
    for (const a of attempts) {
      expect("pos" in a).toBe(false);
      expect("build" in a).toBe(false);
    }
    expect(studyHref(attempts[0])).toBe("/study/#d=100&n=3&h=5");
    expect(await resolveStudyHref(attempts[1], sources())).toBe("/study/postflop/#s=srp-btn-bb&f=3&n=40");
    expect(recentMistakes(attempts)).toHaveLength(2);
    expect(summarize(attempts).n).toBe(2);

    const srs = await repo.allSrs();
    expect(srs.map((s) => s.key).sort()).toEqual(["3:5", "cash6max-40bb:7:9", "p:srp-btn-bb/3:40:1325"]);
    const q = dueReview(srs, NOW);
    expect(q.groups.map((g) => [g.solution, g.items])).toEqual([["cash6max-40bb", [{ nodeId: 7, hand: 9 }]], ["cash6max-100bb", [{ nodeId: 3, hand: 5 }]]]); // one each: the shallower depth first
    // answering one of them again updates it under its old key
    const index = new SrsIndex(srs);
    expect(answerSrs(index, preflopRef(m, "b1", 3), srsKey(SOL, 3, 5), 3, 5, "best", NOW)).toMatchObject({ key: "3:5", seen: 4 });
    expect(answerSrs(index, postflopRef(SCENARIO, flop, 40), legacyPostSrsKey(SCENARIO, FLOP, 40, 1325), 40, 1325, "best", NOW)).toMatchObject({ key: "p:srp-btn-bb/3:40:1325", seen: 2 });
  });

  it("new records travel through a backup file with their position and build, next to old ones", async () => {
    const a = new MemoryRepo();
    await a.importAll(JSON.parse(OLD_BACKUP) as ExportBlob);
    const pre = preAttempt(m, "b1", NODE, HAND, { ts: 1_700_000_005_000 });
    const post = postAttempt(flop, POST_NODE, COMBO, { ts: 1_700_000_006_000 });
    await a.addAttempt(pre);
    await a.addAttempt(post);
    const index = new SrsIndex(await a.allSrs());
    const preItem = answerSrs(index, preflopRef(m, "b1", NODE), srsKey(SOL, NODE, HAND), NODE, HAND, "mistake", NOW);
    const postItem = answerSrs(index, postflopRef(SCENARIO, flop, POST_NODE), legacyPostSrsKey(SCENARIO, FLOP, POST_NODE, COMBO), POST_NODE, COMBO, "mistake", NOW);
    await a.putSrs(preItem);
    await a.putSrs(postItem);

    const file = JSON.stringify(await a.exportAll());
    const b = new MemoryRepo();
    await b.importAll(JSON.parse(file) as ExportBlob);
    const got = await b.allAttempts();
    expect(got).toHaveLength(4);
    expect(got).toContainEqual(expect.objectContaining({ ts: pre.ts, pos: pre.pos, build: "b1", solution: SOL, nodeId: NODE }));
    expect(got).toContainEqual(expect.objectContaining({ ts: post.ts, pos: post.pos, build: post.build, solution: "post:srp-btn-bb" }));
    const srs = await b.allSrs();
    expect(srs).toHaveLength(5);
    expect(srs).toContainEqual(preItem);
    expect(srs).toContainEqual(postItem);
    // importing the same file again changes nothing in the spaced-repetition store
    await b.importAll(JSON.parse(file) as ExportBlob);
    expect(await b.allSrs()).toHaveLength(5);
    expect(new SrsIndex(await b.allSrs()).find(SOL, pre.pos, HAND)).toEqual(preItem);
  });
});
