import { describe, expect, it } from "vitest";
import type { Bookmark } from "../storage/bookmarks";
import { selectSavedPositions } from "../study/savedPositions";

const bookmark = (id: string, created: number, title: string, note = ""): Bookmark => ({
  id,
  created,
  ts: created,
  title,
  note,
  href: "/study/#d=100&n=1",
});

describe("saved position search and sort", () => {
  const list = [
    bookmark("old", 100, "BTN 100bb", "Remember the turn bluff catch"),
    bookmark("middle", 200, "CO 60bb", "Open tighter"),
    bookmark("new", 300, "HJ open", "100bb review"),
  ];

  it("matches title and note without regard to case and trims the query", () => {
    expect(selectSavedPositions(list, "  btn ", "newest").map((item) => item.id)).toEqual(["old"]);
    expect(selectSavedPositions(list, "BLUFF CATCH", "newest").map((item) => item.id)).toEqual(["old"]);
    expect(selectSavedPositions(list, "   ", "newest").map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });

  it("normalizes full-width characters and sorts by the original saved date", () => {
    expect(selectSavedPositions(list, "１００ｂｂ", "oldest").map((item) => item.id)).toEqual(["old", "new"]);
    expect(selectSavedPositions(list, "", "oldest").map((item) => item.id)).toEqual(["old", "middle", "new"]);
    expect(list.map((item) => item.id)).toEqual(["old", "middle", "new"]);
  });
});
