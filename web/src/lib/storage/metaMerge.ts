import { ICM_LOG_KEY, mergeIcmLog } from "./icmLog";
import { BOOKMARKS_KEY, BOOKMARK_DELETIONS_KEY, mergeBookmarkDeletions, mergeBookmarks } from "./bookmarks";

/**
 * Importing a backup: most keys of the `meta` store are simply replaced, but lists that grow on every device
 * are merged with what this device already has.
 */
export function mergeMeta(key: string, current: unknown, incoming: unknown): unknown {
  if (key === ICM_LOG_KEY) return mergeIcmLog(current, incoming);
  if (key === BOOKMARKS_KEY) return mergeBookmarks(current, incoming);
  if (key === BOOKMARK_DELETIONS_KEY) return mergeBookmarkDeletions(current, incoming);
  return incoming;
}
