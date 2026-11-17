import { classInfo } from "../poker/hands";
import { postflopLink, preflopLink } from "../study/links";
import { cardText, COMBOS } from "../postflop/combos";
import type { PfFlop } from "../postflop/decode";
import { flopKey } from "../postflop/positionKey";
import { lineAvailable } from "../postflop/river";
import type { RiverLayer } from "../postflop/river";
import { currentFlopIndex, currentPostflopNode, currentPreflopNode, splitPostflopPos } from "../practice/position";
import { solutionEntry } from "../solution/catalog";
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

/** today's solution data, as far as links need it */
export interface StudySources {
  /** manifest of a pre-flop solution by its id (lib/solution/catalog.ts); rejects when there is none */
  manifest(solution: string): Promise<Manifest>;
  /** the flops of the post-flop index (board texts), in today's order */
  flops: readonly string[];
  flop(scenario: string, flopIndex: number): Promise<PfFlop>;
  /** the rivers solved on this device (lib/postflop/riverSolver.ts): a v3 flop's river lines are looked up with it, never solved */
  river?: RiverLayer;
}

/**
 * The Study link of an attempt: its position key (and for pre-flop the hand). The key is looked up in today's data
 * first — a position that data does not have, or data that cannot be loaded, gives null (the record is still
 * counted, it just has no link).
 */
export async function resolveStudyHref(a: Attempt, src: StudySources): Promise<string | null> {
  try {
    const where = currentFlopIndex(src.flops, a);
    if (where) {
      const flop = await src.flop(where.scenario, where.flopIndex);
      if (currentPostflopNode(flop, a) !== null) return postflopLink(where.scenario, a.pos);
      // a river of a v3 flop is not in the file: the line up to the river start and the card are checked (lib/postflop/river.ts)
      const parts = splitPostflopPos(a.pos);
      const onRiver = flop.version === 3 && src.river && parts && parts.flop === flopKey(flop.board) && (await lineAvailable(src.river, flop, parts.line));
      return onRiver ? postflopLink(where.scenario, a.pos) : null;
    }
    // a pre-flop record of a depth that is not shipped has no link
    const depth = solutionEntry(a.solution)?.stack;
    if (depth === undefined) return null;
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
