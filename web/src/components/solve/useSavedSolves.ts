"use client";
import { useCallback, useEffect, useState } from "react";
import { getRepo } from "@/lib/storage/idb";
import type { SavedRange, SavedSolve } from "@/lib/storage/types";

/**
 * The saved solves (IndexedDB `solves`) and saved ranges the Solve screen lists. `open` is called with the solve named
 * by `#from=<id>` in the address (a link from elsewhere in the app).
 */
export function useSavedSolves(open: (s: SavedSolve) => void) {
  const [mine, setMine] = useState<SavedSolve[]>([]);
  const [ranges, setRanges] = useState<SavedRange[]>([]);

  const refresh = useCallback(
    () =>
      getRepo()
        .listSolves()
        .then(setMine)
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    const repo = getRepo();
    repo.listRanges().then(setRanges).catch(() => {});
    void refresh();
    const from = new URLSearchParams(location.hash.replace(/^#/, "")).get("from");
    if (from) repo.getSolve(from).then((s) => s && open(s)).catch(() => {});
  }, [refresh, open]);

  const put = async (s: SavedSolve) => {
    await getRepo().putSolve(s);
    void refresh();
  };

  const remove = async (id: string) => {
    await getRepo().deleteSolve(id);
    void refresh();
  };

  return { mine, ranges, put, remove };
}
