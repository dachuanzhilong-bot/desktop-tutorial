import { classInfo } from "../poker/hands";
import { postflopLink, preflopLink } from "../study/links";
import { cardText, COMBOS } from "../postflop/combos";
import type { PfFlop } from "../postflop/decode";
import { currentFlopIndex, currentPostflopNode, currentPreflopNode, parsePostSolution } from "../practice/position";
import type { Manifest } from "../solution/types";
import type { Attempt } from "./types";

/** the mistake notebook: the latest big mistakes, one per position and hand, newest first */
export function recentMistakes(list: Attempt[], limit = 8): Attempt[] {
  const seen = new Set<string>();
  const out: Attempt[] = [];
  for (const a of [...list].sort((x, y) => y.ts - x.ts)) {
    if (a.grade !== "mistake" && a.grade !== "blunder") continue;
    // the position: its key when the record has one (never the same text as a node id), else the node id
    const key = `${a.solution}:${a.pos ?? a.nodeId}:${a.hand}`;
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

/**
 * Where the Study screen shows the position of an attempt made before position keys (the node, and for pre-flop the
 * hand too); null when it cannot be told. An attempt with `pos` gets no link here: its node id may be out of date,
 * the link comes from resolveStudyHref, which looks the position up in today's data.
 */
export function studyHref(a: Attempt): string | null {
  if (a.pos !== undefined) return null;
  const post = parsePostSolution(a.solution);
  if (post) return post.flopIndex === null ? null : postflopLink(post.scenario, post.flopIndex, a.nodeId);
  const depth = preflopDepth(a.solution);
  return depth === null ? null : preflopLink(depth, a.nodeId, a.hand);
}

/** today's solution data, as far as links need it */
export interface StudySources {
  /** manifest of a pre-flop solution by its id (`cash6max-100bb`); rejects when there is none */
  manifest(solution: string): Promise<Manifest>;
  /** the flops of the post-flop index (board texts), in today's order */
  flops: readonly string[];
  flop(scenario: string, flopIndex: number): Promise<PfFlop>;
}

/**
 * The Study link of an attempt in today's data. With `pos` the node (and the flop) is looked up again by the
 * position key, so the link stays on the same position after the data was generated again; a position today's
 * data does not have, or data that cannot be loaded, gives null (the record is still counted, it just has no link).
 * Without `pos` this is studyHref.
 */
export async function resolveStudyHref(a: Attempt, src: StudySources): Promise<string | null> {
  if (a.pos === undefined) return studyHref(a);
  try {
    const where = currentFlopIndex(src.flops, a);
    if (where) {
      const node = currentPostflopNode(await src.flop(where.scenario, where.flopIndex), a);
      return node === null ? null : postflopLink(where.scenario, where.flopIndex, node);
    }
    const depth = preflopDepth(a.solution);
    if (depth === null) return null;
    const node = currentPreflopNode(await src.manifest(a.solution), a);
    return node === null ? null : preflopLink(depth, node, a.hand);
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
