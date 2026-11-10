import { classInfo } from "../poker/hands";
import { cardText, COMBOS } from "../postflop/combos";
import type { Attempt } from "./types";

/** the mistake notebook: the latest big mistakes, one per position and hand, newest first */
export function recentMistakes(list: Attempt[], limit = 8): Attempt[] {
  const seen = new Set<string>();
  const out: Attempt[] = [];
  for (const a of [...list].sort((x, y) => y.ts - x.ts)) {
    if (a.grade !== "mistake" && a.grade !== "blunder") continue;
    const key = `${a.solution}:${a.nodeId}:${a.hand}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

/** where the Study screen shows the position of an attempt (the node, and for pre-flop the hand too); null when it cannot be told */
export function studyHref(a: Attempt): string | null {
  const post = /^post:([\w-]+)\/(\d+)$/.exec(a.solution);
  if (post) return `/study/postflop/#s=${post[1]}&f=${post[2]}&n=${a.nodeId}`;
  const depth = /^cash6max-(\d+)bb$/.exec(a.solution);
  if (!depth) return null;
  return `/study/#d=${depth[1]}&n=${a.nodeId}&h=${a.hand}`;
}

/** "AKs" for a pre-flop hand class, "AhKh" for a post-flop combo */
export function handLabel(a: Attempt): string {
  if (a.solution.startsWith("post:")) {
    const c = COMBOS[a.hand];
    return c ? cardText(c.c1) + cardText(c.c2) : "";
  }
  return a.hand >= 0 && a.hand < 169 ? classInfo(a.hand).name : "";
}
