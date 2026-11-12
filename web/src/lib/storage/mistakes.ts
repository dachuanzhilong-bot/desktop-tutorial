import { classInfo } from "../poker/hands";
import { postflopLink, preflopLink } from "../study/links";
import { cardText, COMBOS } from "../postflop/combos";
import type { PfFlop } from "../postflop/decode";
import { currentFlopIndex, currentPostflopNode, currentPreflopNode } from "../practice/position";
import type { Manifest } from "../solution/types";
import type { Attempt } from "./types";

/** the mistake notebook: the latest big mistakes, one per position and hand, newest first */
export function recentMistakes(list: Attempt[], limit = 8): Attempt[] {
  const seen = new Set<string>();
  const out: Attempt[] = [];
  for (const a of [...list].sort((x, y) => y.ts - x.ts)) {
    if (a.grade !== "mistake" && a.grade !== "blunder") continue;
    const key = `${a.solution}:${a.pos}:${a.hand}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

const preflopDepth = (solution: string): number | null => {
  const m = /^cash6max-(\d+)bb$/.exec(solution);
  return m ? Number(m[1]) : null;
};

/** today's solution data, as far as links need it */
export interface StudySources {
  /** manifest of a pre-flop solution by its id (`cash6max-100bb`); rejects when there is none */
  manifest(solution: string): Promise<Manifest>;
  /** the flops of the post-flop index (board texts), in today's order */
  flops: readonly string[];
  flop(scenario: string, flopIndex: number): Promise<PfFlop>;
}

/**
 * The Study link of an attempt: its position key (and for pre-flop the hand). The key is looked up in today's data
 * first — a position that data does not have, or data that cannot be loaded, gives null (the record is still
 * counted, it just has no link).
 */
export async function resolveStudyHref(a: Attempt, src: StudySources): Promise<string | null> {
  try {
    const where = currentFlopIndex(src.flops, a);
    if (where) return currentPostflopNode(await src.flop(where.scenario, where.flopIndex), a) === null ? null : postflopLink(where.scenario, a.pos);
    const depth = preflopDepth(a.solution);
    if (depth === null) return null;
    return currentPreflopNode(await src.manifest(a.solution), a) === null ? null : preflopLink(depth, a.pos, a.hand);
  } catch {
    return null;
  }
}

/** "AKs" for a pre-flop hand class, "AhKh" for a post-flop combo */
export function handLabel(a: Attempt): string {
  if (a.solution.startsWith("post:")) {
    const c = COMBOS[a.hand];
    return c ? cardText(c.c1) + cardText(c.c2) : "";
  }
  return a.hand >= 0 && a.hand < 169 ? classInfo(a.hand).name : "";
}
