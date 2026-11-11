"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getRepo } from "./idb";
import { readLessonsDone, setLessonDone } from "./lessons";

/** the finished lessons: the set (null while it loads) and a toggle */
export function useLessons() {
  const [list, setList] = useState<{ id: string; ts: number }[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    readLessonsDone(getRepo())
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);
  const done = useMemo(() => (list ? new Set(list.map((x) => x.id)) : null), [list]);
  const toggle = useCallback(
    async (id: string, on: boolean) => {
      try {
        setList(await setLessonDone(getRepo(), id, on));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [],
  );
  return { done, failed, toggle };
}
