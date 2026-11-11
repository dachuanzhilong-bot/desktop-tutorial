"use client";
import { useCallback, useEffect, useState } from "react";
import { newId } from "../util/id";
import { readBookmarks, removeBookmark, upsertBookmark } from "./bookmarks";
import type { Bookmark } from "./bookmarks";
import { getRepo } from "./idb";

/** the saved Study positions: the list (null while it loads) and the three things one can do with it */
export function useBookmarks() {
  const [list, setList] = useState<Bookmark[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    readBookmarks(getRepo())
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);
  const run = useCallback(async (job: Promise<Bookmark[]>) => {
    try {
      setList(await job);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  /** saves a position; when it is already saved (same address) it is taken out instead */
  const toggle = useCallback(
    (href: string, title: string) => {
      const have = list?.find((b) => b.href === href);
      return run(have ? removeBookmark(getRepo(), have.id) : upsertBookmark(getRepo(), { id: newId("bm"), created: Date.now(), ts: Date.now(), title, note: "", href }));
    },
    [list, run],
  );
  const setNote = useCallback((b: Bookmark, note: string) => run(upsertBookmark(getRepo(), { ...b, note, ts: Date.now() })), [run]);
  const remove = useCallback((id: string) => run(removeBookmark(getRepo(), id)), [run]);
  return { list, failed, toggle, setNote, remove };
}
