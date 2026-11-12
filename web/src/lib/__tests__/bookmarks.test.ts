import { describe, expect, it } from "vitest";
import { BOOKMARKS_KEY, BOOKMARK_DELETIONS_KEY, BOOKMARKS_MAX, mergeBookmarks, mergeSyncedBookmarks, NOTE_MAX, readBookmarkDeletions, readBookmarks, removeBookmark, sanitizeBookmarks, TITLE_MAX, upsertBookmark } from "../storage/bookmarks";
import type { Bookmark } from "../storage/bookmarks";
import { MemoryRepo } from "../storage/memory";
import { isPositionHref, parsePostflopHash, parsePreflopHash, postflopHash, postflopLink, postflopTargetFlop, preflopHash, preflopLink, preflopTarget } from "../study/links";
import { loadManifest, walk } from "./helpers";

const bm = (o: Partial<Bookmark> = {}): Bookmark => ({ id: "a", ts: 1000, created: o.created ?? o.ts ?? 1000, title: "100bb · BTN", note: "", href: "/study/#d=100&p=F-F-R2.5", ...o });

describe("study links", () => {
  it("builds the deep links Study reads", () => {
    // a link names its position by a position key, never by a node number or a flop's index
    expect(preflopLink(100, "F-F-R2.5-F-F")).toBe("/study/#d=100&p=F-F-R2.5-F-F");
    expect(preflopLink(60, "root", 14)).toBe("/study/#d=60&p=root&h=14");
    expect(preflopHash(60, "root", 14)).toBe("#d=60&p=root&h=14");
    expect(preflopHash(100, "F-F-R2.5", null)).toBe("#d=100&p=F-F-R2.5");
    expect(postflopLink("srp-btn-bb", "9s6d3c@X-B1.75-C/Td")).toBe("/study/postflop/#s=srp-btn-bb&p=9s6d3c@X-B1.75-C/Td");
    expect(postflopHash("srp-btn-bb", "9s6d3c@root")).toBe("#s=srp-btn-bb&p=9s6d3c@root");
  });

  it("reads them back, and reads (but never writes) the addresses that held numbers", () => {
    expect(parsePreflopHash("#d=60&p=F-F-R2.5&h=14")).toEqual({ depth: 60, pos: "F-F-R2.5", number: null, hand: 14 });
    expect(parsePreflopHash("d=100&p=root")).toEqual({ depth: 100, pos: "root", number: null, hand: null });
    expect(parsePreflopHash("")).toEqual({ depth: null, pos: null, number: null, hand: null });
    expect(parsePreflopHash("#d=x&h=169&n=-1")).toEqual({ depth: null, pos: null, number: null, hand: null });
    expect(parsePreflopHash("#d=40&n=12")).toEqual({ depth: 40, pos: null, number: 12, hand: null }); // written before position keys
    expect(parsePostflopHash("#s=srp-btn-bb&p=9s6d3c@X-B1.75-C/Td")).toEqual({ solve: null, scenario: "srp-btn-bb", pos: "9s6d3c@X-B1.75-C/Td", flopNumber: null, number: null });
    expect(parsePostflopHash("#solve=abc")).toMatchObject({ solve: "abc", scenario: null, pos: null });
    expect(parsePostflopHash("#s=srp-btn-bb&f=2&n=0")).toEqual({ solve: null, scenario: "srp-btn-bb", pos: null, flopNumber: 2, number: 0 });
  });

  it("opens the node the key has in the loaded solution; a key it does not have opens the root", () => {
    const m = loadManifest();
    const node = walk(m, "FFR");
    expect(node).toBeGreaterThan(0);
    const key = parsePreflopHash(preflopHash(100, "F-F-R2.5", null));
    expect(preflopTarget(m, key)).toBe(node);
    expect(preflopTarget(m, parsePreflopHash("#d=100&p=root"))).toBe(0);
    expect(preflopTarget(m, parsePreflopHash("#d=100&p=F-F-R999"))).toBe(0); // not a position of this solution
    expect(preflopTarget(m, parsePreflopHash("#d=100&p=garbage"))).toBe(0);
    // the key wins over a number in the same address
    expect(preflopTarget(m, parsePreflopHash(`#d=100&n=1&p=F-F-R2.5`))).toBe(node);
    // an old address: its number, when the solution has such a node; otherwise the view stays where it is
    expect(preflopTarget(m, parsePreflopHash("#n=1"))).toBe(1);
    expect(preflopTarget(m, parsePreflopHash(`#n=${m.nodes.length}`))).toBeNull();
    expect(preflopTarget(m, parsePreflopHash("#d=100"))).toBeNull();

    const flops = ["As 7d 2c", "9s 6d 3c"];
    expect(postflopTargetFlop(flops, parsePostflopHash("#s=x&p=9s6d3c@X-X/Td"))).toEqual({ flopIndex: 1, line: "X-X/Td", number: null });
    expect(postflopTargetFlop(flops, parsePostflopHash("#s=x&p=KsKdKc@root"))).toEqual({ flopIndex: 0, line: null, number: null }); // a flop that is not there
    expect(postflopTargetFlop(flops, parsePostflopHash("#s=x&p=nonsense"))).toEqual({ flopIndex: 0, line: null, number: null });
    expect(postflopTargetFlop(flops, parsePostflopHash("#s=x"))).toBeNull();
    expect(postflopTargetFlop(flops, parsePostflopHash("#s=x&f=1&n=4"))).toEqual({ flopIndex: 1, line: null, number: 4 });
    expect(postflopTargetFlop(flops, parsePostflopHash("#s=x&f=99"))).toEqual({ flopIndex: 1, line: null, number: null });
  });

  it("a saved position needs a position key: addresses with numbers are not kept", () => {
    for (const ok of ["/study/#d=100&p=root", "/study/#d=60&p=F-F-R2.5-F-F&h=14", "/study/postflop/#s=srp-btn-bb&p=9s6d3c@X-B1.75-C/Td"]) expect(isPositionHref(ok)).toBe(true);
    for (const bad of ["/study/#d=100&n=3", "/study/#d=100&n=3&h=5", "/study/postflop/#s=srp-btn-bb&f=3&n=7", "/study/#d=100", "/study/#d=100&p=root&n=3", "/study/#", "/solve/#p=root", "https://example.com/study/#d=100&p=root", "javascript:alert(1)", "", null, 5])
      expect(isPositionHref(bad)).toBe(false);
  });
});

describe("saved positions", () => {
  it("keeps well-formed bookmarks only, newest first, and trims the text", () => {
    const long = "x".repeat(5000);
    const list = sanitizeBookmarks([
      bm({ id: "old", ts: 1 }),
      bm({ id: "new", ts: 9, title: long, note: long }),
      { id: "", ts: 1, title: "t", note: "", href: "/study/#d=1&p=root" }, // no id
      { ...bm({ id: "x" }), href: "https://example.com/study/#d=1&p=root" }, // not an app path
      { ...bm({ id: "y" }), href: "/solve/#d=1&p=root" }, // not a Study path
      { ...bm({ id: "z" }), ts: Number.NaN },
      { id: "legacy", ts: 7, title: "t", note: "", href: "/study/#d=40&p=F" }, // saved before `created` existed: it takes ts
      { ...bm({ id: "w" }), note: 5 },
      null,
      "text",
    ]);
    expect(list.map((b) => b.id)).toEqual(["new", "legacy", "old"]);
    expect(list[1].created).toBe(7);
    expect(list[0].title).toHaveLength(TITLE_MAX);
    expect(list[0].note).toHaveLength(NOTE_MAX);
    expect(sanitizeBookmarks({ not: "a list" })).toEqual([]);
    expect(sanitizeBookmarks(undefined)).toEqual([]);
  });

  it("merges two lists: the later edit of an id wins, nothing is lost, and the size is capped", () => {
    const here = [bm({ id: "a", ts: 10, note: "mine" }), bm({ id: "b", ts: 5 })];
    const there = [bm({ id: "a", ts: 20, note: "theirs" }), bm({ id: "c", ts: 7 })];
    const m = mergeBookmarks(here, there);
    expect(m.map((b) => [b.id, b.note])).toEqual([["a", "theirs"], ["c", ""], ["b", ""]]);
    expect(m[0]).toMatchObject({ ts: 20, created: 10 }); // the later edit, with the earlier save time
    expect(mergeBookmarks(there, here)).toEqual(m); // the order of the two does not matter
    const many = Array.from({ length: BOOKMARKS_MAX + 20 }, (_, i) => bm({ id: `i${i}`, ts: i }));
    const cap = mergeBookmarks(many, []);
    expect(cap).toHaveLength(BOOKMARKS_MAX);
    expect(cap[0].id).toBe(`i${BOOKMARKS_MAX + 19}`);
  });

  it("saves, edits and removes, also when the taps come at once", async () => {
    const repo = new MemoryRepo();
    await Promise.all([1, 2, 3, 4].map((i) => upsertBookmark(repo, bm({ id: `b${i}`, ts: i, href: `/study/#d=100&p=F-R${i}` }))));
    expect((await readBookmarks(repo)).map((b) => b.id)).toEqual(["b4", "b3", "b2", "b1"]);
    await upsertBookmark(repo, bm({ id: "b2", created: 2, ts: 50, note: "limp is a mistake here", href: "/study/#d=100&p=F-R2" }));
    const after = await readBookmarks(repo);
    expect(after.map((b) => b.id)).toEqual(["b4", "b3", "b2", "b1"]); // editing a note does not move it
    expect(after[2]).toMatchObject({ note: "limp is a mistake here", ts: 50 });
    await removeBookmark(repo, "b3");
    expect((await readBookmarks(repo)).map((b) => b.id)).toEqual(["b4", "b2", "b1"]);
    expect(await readBookmarkDeletions(repo)).toEqual([{ id: "b3", ts: expect.any(Number) }]);
    await expect(upsertBookmark(repo, bm({ id: "bad", href: "javascript:alert(1)" }))).rejects.toThrow();
    expect(await readBookmarks(repo)).toHaveLength(3);
  });

  it("keeps a synced deletion over an older copy and accepts a later re-save", async () => {
    const repo = new MemoryRepo();
    await upsertBookmark(repo, bm({ id: "x", ts: 10 }));
    await removeBookmark(repo, "x");
    const deletedAt = (await readBookmarkDeletions(repo))[0].ts;

    await mergeSyncedBookmarks(repo, [bm({ id: "x", ts: 10, note: "stale copy" })], []);
    expect(await readBookmarks(repo)).toEqual([]);
    expect((await readBookmarkDeletions(repo))[0].ts).toBe(deletedAt);

    await mergeSyncedBookmarks(repo, [bm({ id: "x", ts: deletedAt, note: "same-time copy" })], []);
    expect(await readBookmarks(repo)).toEqual([]);

    await mergeSyncedBookmarks(repo, [bm({ id: "x", ts: deletedAt + 1, note: "saved again" })], []);
    expect(await readBookmarks(repo)).toMatchObject([{ id: "x", note: "saved again" }]);
    expect(await readBookmarkDeletions(repo)).toEqual([]);
  });

  it("travels in the backup file and is merged, not replaced, on import", async () => {
    const a = new MemoryRepo();
    await upsertBookmark(a, bm({ id: "x", ts: 10, note: "from the phone" }));
    const blob = JSON.parse(JSON.stringify(await a.exportAll()));
    expect(blob.meta[BOOKMARKS_KEY]).toHaveLength(1);
    const b = new MemoryRepo();
    await upsertBookmark(b, bm({ id: "y", ts: 20, href: "/study/#d=40&p=F" }));
    await b.importAll(blob);
    await b.importAll(blob);
    expect((await readBookmarks(b)).map((x) => x.id)).toEqual(["y", "x"]);

    await removeBookmark(b, "x");
    const afterDelete = await b.exportAll();
    expect(afterDelete.meta[BOOKMARK_DELETIONS_KEY]).toHaveLength(1);
    await b.importAll(blob);
    expect((await readBookmarks(b)).map((x) => x.id)).toEqual(["y"]);
  });
});
