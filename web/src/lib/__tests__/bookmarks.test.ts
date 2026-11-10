import { describe, expect, it } from "vitest";
import { BOOKMARKS_KEY, BOOKMARKS_MAX, mergeBookmarks, NOTE_MAX, readBookmarks, removeBookmark, sanitizeBookmarks, TITLE_MAX, upsertBookmark } from "../storage/bookmarks";
import type { Bookmark } from "../storage/bookmarks";
import { MemoryRepo } from "../storage/memory";
import { postflopLink, preflopHash, preflopLink } from "../study/links";

const bm = (o: Partial<Bookmark> = {}): Bookmark => ({ id: "a", ts: 1000, created: o.created ?? o.ts ?? 1000, title: "100bb · BTN", note: "", href: "/study/#d=100&n=3", ...o });

describe("study links", () => {
  it("builds the deep links Study reads", () => {
    expect(preflopLink(100, 12)).toBe("/study/#d=100&n=12");
    expect(preflopLink(60, 0, 14)).toBe("/study/#d=60&n=0&h=14");
    expect(preflopHash(60, 0, 14)).toBe("#d=60&n=0&h=14");
    expect(preflopHash(100, 5, null)).toBe("#d=100&n=5");
    expect(postflopLink("srp-btn-bb", 3, 7)).toBe("/study/postflop/#s=srp-btn-bb&f=3&n=7");
  });
});

describe("saved positions", () => {
  it("keeps well-formed bookmarks only, newest first, and trims the text", () => {
    const long = "x".repeat(5000);
    const list = sanitizeBookmarks([
      bm({ id: "old", ts: 1 }),
      bm({ id: "new", ts: 9, title: long, note: long }),
      { id: "", ts: 1, title: "t", note: "", href: "/study/#d=1" }, // no id
      { ...bm({ id: "x" }), href: "https://example.com/study/#d=1" }, // not an app path
      { ...bm({ id: "y" }), href: "/solve/#d=1" }, // not a Study path
      { ...bm({ id: "z" }), ts: Number.NaN },
      { id: "legacy", ts: 7, title: "t", note: "", href: "/study/#d=40&n=1" }, // saved before `created` existed: it takes ts
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
    await Promise.all([1, 2, 3, 4].map((i) => upsertBookmark(repo, bm({ id: `b${i}`, ts: i, href: `/study/#d=100&n=${i}` }))));
    expect((await readBookmarks(repo)).map((b) => b.id)).toEqual(["b4", "b3", "b2", "b1"]);
    await upsertBookmark(repo, bm({ id: "b2", created: 2, ts: 50, note: "limp is a mistake here", href: "/study/#d=100&n=2" }));
    const after = await readBookmarks(repo);
    expect(after.map((b) => b.id)).toEqual(["b4", "b3", "b2", "b1"]); // editing a note does not move it
    expect(after[2]).toMatchObject({ note: "limp is a mistake here", ts: 50 });
    await removeBookmark(repo, "b3");
    expect((await readBookmarks(repo)).map((b) => b.id)).toEqual(["b4", "b2", "b1"]);
    await expect(upsertBookmark(repo, bm({ id: "bad", href: "javascript:alert(1)" }))).rejects.toThrow();
    expect(await readBookmarks(repo)).toHaveLength(3);
  });

  it("travels in the backup file and is merged, not replaced, on import", async () => {
    const a = new MemoryRepo();
    await upsertBookmark(a, bm({ id: "x", ts: 10, note: "from the phone" }));
    const blob = JSON.parse(JSON.stringify(await a.exportAll()));
    expect(blob.meta[BOOKMARKS_KEY]).toHaveLength(1);
    const b = new MemoryRepo();
    await upsertBookmark(b, bm({ id: "y", ts: 20, href: "/study/#d=40&n=1" }));
    await b.importAll(blob);
    await b.importAll(blob);
    expect((await readBookmarks(b)).map((x) => x.id)).toEqual(["y", "x"]);
  });
});
