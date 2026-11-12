/**
 * Records in the format before position keys are deleted, not converted (REFACTOR_PLAN step 1-4).
 * These are the rules the database upgrade (lib/storage/idb.ts, run for real in e2e/migration.spec.ts), the backup
 * import and the sync pull share: what counts as an old record, which `meta` keys go, and what stays.
 */
import { describe, expect, it } from "vitest";
import { BOOKMARK_DELETIONS_KEY, BOOKMARKS_KEY, readBookmarks, sanitizeBookmarks } from "../storage/bookmarks";
import { ICM_LOG_KEY } from "../storage/icmLog";
import { LESSONS } from "../learn/lessons";
import { LESSONS_KEY } from "../storage/lessons";
import { MemoryRepo } from "../storage/memory";
import { attemptKey, currentPart, isCurrentAttempt, isCurrentHand, isCurrentSrs, isObsoleteMetaKey } from "../storage/obsolete";
import type { ExportBlob } from "../storage/types";

const oldAttempt = { ts: 1_700_000_000_000, sessionId: "old", mode: "spot", solution: "cash6max-100bb", nodeId: 3, hand: 5, seat: 3, spot: "rfi", chosen: 1, best: 0, grade: "mistake", evLoss: 0.3, score: 30, ms: 800, rng: false, timeout: false, hint: false };
const newAttempt = { ...oldAttempt, ts: 1_700_000_005_000, pos: "F-F-R2.5", build: "17035ecae421" };
const oldSrs = { key: "3:5", nodeId: 3, hand: 5, box: 0, due: 0, seen: 3, lapses: 1, lastGrade: "mistake", updated: 1_700_000_000_000 };
const newSrs = { ...oldSrs, key: "k:cash6max-100bb:F-F-R2.5:5", solution: "cash6max-100bb", pos: "F-F-R2.5" };
const decision = { nodeId: 3, pos: "F-F-R2.5", seat: 2, spot: "rfi", handClass: 5, chosen: 0, chosenKind: 0, stats: [], best: 1, evLoss: 0.2, grade: "mistake", score: 40, sizeNote: null };
const { pos: _pos, ...oldDecision } = decision;
const hand = (analysis: object) => ({ id: "h1", site: "x", ts: 1, importedAt: 2, hand: {}, analysis });
const newHand = hand({ id: "h1", solution: "cash6max-100bb", status: "ok", decisions: [decision], offTree: [], evLoss: 0.2, worst: decision, flopLink: null });

describe("what counts as a record in the old format", () => {
  it("a practice record needs a position key", () => {
    expect(isCurrentAttempt(newAttempt)).toBe(true);
    expect(isCurrentAttempt({ ...newAttempt, build: undefined })).toBe(true); // the build ID is optional
    expect(isCurrentAttempt(oldAttempt)).toBe(false);
    expect(isCurrentAttempt({ ...oldAttempt, solution: "post:srp-btn-bb/3", mode: "postSpot" })).toBe(false);
    for (const bad of [{ ...oldAttempt, pos: "" }, { ...oldAttempt, pos: null }, { ...oldAttempt, pos: 3 }, null, undefined, "x", 5]) expect(isCurrentAttempt(bad)).toBe(false);
  });

  it("a spaced-repetition item needs a solution and a position key", () => {
    expect(isCurrentSrs(newSrs)).toBe(true);
    expect(isCurrentSrs({ ...newSrs, key: "k:post:srp-btn-bb:9s6d3c@root:1325", solution: "post:srp-btn-bb", pos: "9s6d3c@root" })).toBe(true);
    for (const old of [oldSrs, { ...oldSrs, key: "cash6max-40bb:7:9" }, { ...oldSrs, key: "p:srp-btn-bb/3:40:1325" }]) expect(isCurrentSrs(old)).toBe(false);
    expect(isCurrentSrs({ ...newSrs, solution: undefined })).toBe(false);
    expect(isCurrentSrs({ ...newSrs, pos: null })).toBe(false);
    expect(isCurrentSrs(null)).toBe(false);
  });

  it("an imported hand needs its solution and a position key on every graded decision", () => {
    expect(isCurrentHand(newHand)).toBe(true);
    // not graded at all: it points at no position
    expect(isCurrentHand(hand({ id: "h1", solution: "cash6max-100bb", status: "skipped", decisions: [], offTree: [], evLoss: 0, worst: null, flopLink: null }))).toBe(true);
    expect(isCurrentHand(hand({ ...newHand.analysis, decisions: [decision, oldDecision] }))).toBe(false);
    expect(isCurrentHand(hand({ ...newHand.analysis, decisions: [oldDecision], worst: oldDecision }))).toBe(false);
    expect(isCurrentHand(hand({ ...newHand.analysis, worst: oldDecision }))).toBe(false);
    expect(isCurrentHand(hand({ ...newHand.analysis, solution: undefined }))).toBe(false); // analysed before stack depths existed
    for (const bad of [hand({}), { id: "h1" }, null, 7]) expect(isCurrentHand(bad)).toBe(false);
  });

  it("meta: saved positions, their tombstones, sync states and prepared question lists go; the rest stays", () => {
    for (const k of [BOOKMARKS_KEY, BOOKMARK_DELETIONS_KEY, "study.bookmarks", "study.bookmarkDeletions", "sync.state.user-1", "sync.state.", "practiceSet:review", "practiceSet:a-123"]) expect(isObsoleteMetaKey(k)).toBe(true);
    for (const k of [ICM_LOG_KEY, LESSONS_KEY, "icm.log", "learn.done", "study.bookmarksX", "sync", "practiceSet", "anything.else", "", 3, null]) expect(isObsoleteMetaKey(k)).toBe(false);
  });

  it("two copies of one practice record have the same key; another position at the same time does not", () => {
    const renumbered = { ...newAttempt, nodeId: 999 };
    expect(attemptKey(newAttempt)).toBe(attemptKey(renumbered)); // the node id is not part of it
    expect(attemptKey(newAttempt)).not.toBe(attemptKey({ ...newAttempt, pos: "F-F-F" }));
    expect(attemptKey(newAttempt)).not.toBe(attemptKey({ ...newAttempt, hand: 6 }));
  });
});

describe("reading a backup file", () => {
  const blob = (o: object): ExportBlob => JSON.parse(JSON.stringify({ app: "tessera", version: 1, exportedAt: 1, attempts: [], srs: [], meta: {}, ...o })) as ExportBlob;

  it("old records are left out and counted; ranges, the ICM log, lessons and records with a position are read", async () => {
    const file = blob({
      attempts: [oldAttempt, newAttempt],
      srs: [oldSrs, newSrs],
      hands: [newHand, { ...hand({ ...newHand.analysis, decisions: [oldDecision], worst: oldDecision }), id: "h-old" }],
      ranges: [{ id: "r1", ts: 5, name: "BTN open", text: "AA,KK" }],
      meta: {
        [ICM_LOG_KEY]: [{ ts: 1_700_000_000_000, players: 3, pos: "BTN", stack: 8, facing: null, hand: 10, chosen: 1, grade: "best", evLoss: 0, score: 100 }],
        [LESSONS_KEY]: [{ id: LESSONS[0].id, ts: 9 }],
        [BOOKMARKS_KEY]: [
          { id: "old", created: 1, ts: 1, title: "BTN", note: "", href: "/study/#d=100&n=3" },
          { id: "new", created: 2, ts: 2, title: "CO", note: "keep", href: "/study/#d=100&p=F-F-R2.5" },
        ],
        "sync.state.user-1": { clientId: "c", pushedAttemptId: 500, lastSync: 1 },
        "practiceSet:review": { title: "x", solution: "cash6max-100bb", items: [{ nodeId: 3, hand: 5 }] },
      },
    });
    expect(currentPart(file).report).toEqual({ dropped: 3 });

    const repo = new MemoryRepo();
    expect(await repo.importAll(file)).toEqual({ dropped: 3 });
    expect((await repo.allAttempts()).map((a) => a.pos)).toEqual(["F-F-R2.5"]);
    expect((await repo.allSrs()).map((s) => s.key)).toEqual(["k:cash6max-100bb:F-F-R2.5:5"]);
    expect((await repo.listHands()).map((h) => h.id)).toEqual(["h1"]);
    expect(await repo.listRanges()).toEqual([{ id: "r1", ts: 5, name: "BTN open", text: "AA,KK" }]);
    expect(await repo.getMeta(ICM_LOG_KEY)).toHaveLength(1);
    expect(await repo.getMeta(LESSONS_KEY)).toEqual([{ id: LESSONS[0].id, ts: 9 }]);
    // a saved position with a position key is kept; one whose address holds a node number is not a bookmark any more
    expect((await readBookmarks(repo)).map((b) => b.id)).toEqual(["new"]);
    // another database's sync cursors and question lists are not taken over
    expect(await repo.getMeta("sync.state.user-1")).toBeUndefined();
    expect(await repo.getMeta("practiceSet:review")).toBeUndefined();
  });

  it("a file without the lists, or of something else, does not break the import", async () => {
    const repo = new MemoryRepo();
    expect(await repo.importAll({ app: "tessera", version: 1, exportedAt: 1 } as unknown as ExportBlob)).toEqual({ dropped: 0 });
    await expect(repo.importAll({ app: "other" } as unknown as ExportBlob)).rejects.toThrow("not a Tessera export");
    await expect(repo.importAll(null as unknown as ExportBlob)).rejects.toThrow("not a Tessera export");
  });

  it("saved positions: an address with numbers is dropped wherever it comes from", () => {
    const list = [
      { id: "a", created: 1, ts: 1, title: "t", note: "", href: "/study/#d=100&n=3" },
      { id: "b", created: 2, ts: 2, title: "t", note: "", href: "/study/postflop/#s=srp-btn-bb&f=3&n=7" },
      { id: "c", created: 3, ts: 3, title: "t", note: "", href: "/study/postflop/#s=srp-btn-bb&p=9s6d3c@X-B1.75-C/Td" },
      { id: "d", created: 4, ts: 4, title: "t", note: "", href: "/study/#d=40&p=root&h=14" },
    ];
    expect(sanitizeBookmarks(list).map((b) => b.id)).toEqual(["d", "c"]);
  });
});
