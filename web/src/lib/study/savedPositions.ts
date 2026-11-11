import type { Bookmark } from "../storage/bookmarks";

export type SavedPositionSort = "newest" | "oldest";

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function compareBySavedDate(a: Bookmark, b: Bookmark): number {
  return a.created - b.created || a.ts - b.ts || a.id.localeCompare(b.id);
}

/** Filters by title or note, then sorts by the time the position was first saved. */
export function selectSavedPositions(list: Bookmark[], query: string, order: SavedPositionSort): Bookmark[] {
  const needle = normalize(query.trim());
  return list
    .filter((bookmark) => !needle || normalize(`${bookmark.title}\n${bookmark.note}`).includes(needle))
    .sort((a, b) => (order === "newest" ? compareBySavedDate(b, a) : compareBySavedDate(a, b)));
}
