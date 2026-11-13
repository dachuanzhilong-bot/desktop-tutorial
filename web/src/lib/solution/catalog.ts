/**
 * The catalog of the shipped preflop solutions (REFACTOR_PLAN step 2-4, ARCHITECTURE problem F).
 *
 * public/solutions/index.json is the one list of what is shipped: scripts/pack-solutions.mjs writes it from the
 * manifests (id, game, players, stack) and scripts/build-id.mjs adds the build IDs. Like the postflop index
 * (lib/postflop/loader.ts PF_INDEX) it is part of the build, not fetched: the app and the data it asks for always
 * belong together. The depth list, the solution ids and "is this a preflop solution" all come from here; no other
 * file spells a solution id out.
 *
 * Today there is one solution per stack depth (cash, 6 seats); the data test checks that the stacks are unique.
 * Solution ids are what records store (`Attempt.solution`), so they never change their meaning.
 */
import indexJson from "../../../public/solutions/index.json";

export interface SolutionEntry {
  /** directory name and record value, e.g. the 100bb cash solution */
  id: string;
  /** "cash": the preflop solver has no tournament model */
  game: string;
  /** number of seats (manifest.players.length) */
  players: number;
  /** effective stack depth in bb (manifest.stack) */
  stack: number;
  /** build ID of the packed files (scripts/build-id.mjs) */
  build: string;
  /** packed files, for the service worker's precache */
  files: string[];
}

/** every shipped preflop solution, shallowest first */
export const SOLUTIONS: readonly SolutionEntry[] = [...indexJson.solutions].sort((a, b) => a.stack - b.stack);

const BY_ID = new Map<string, SolutionEntry>(SOLUTIONS.map((s) => [s.id, s]));
const BY_STACK = new Map<number, SolutionEntry>(SOLUTIONS.map((s) => [s.stack, s]));

/** effective stack depths (bb) a preflop solution exists for, ascending */
export const DEPTHS: readonly number[] = SOLUTIONS.map((s) => s.stack);
export type Depth = number;

/** the depth whose solution is closest to an effective stack (compared on a log scale: 70bb is nearer 60 than 100) */
export function nearestDepth(stack: number): Depth {
  let best: Depth = DEPTHS[0];
  let d = Infinity;
  for (const x of DEPTHS) {
    const e = Math.abs(Math.log(Math.max(stack, 1) / x));
    if (e < d) {
      d = e;
      best = x;
    }
  }
  return best;
}

/** the depth the app starts with: the usual 100bb cash game, or the shipped depth nearest to it */
export const DEFAULT_DEPTH: Depth = nearestDepth(100);

/** the catalog entry of a solution id, or undefined when it is not shipped (an old record, a post-flop id) */
export const solutionEntry = (id: string | undefined): SolutionEntry | undefined => (id === undefined ? undefined : BY_ID.get(id));

/** whether `id` names a shipped preflop solution */
export const isPreflopSolution = (id: string | undefined): boolean => solutionEntry(id) !== undefined;

/** the id of the solution at a shipped depth; a depth that is not shipped gets the nearest one's */
export const solutionId = (depth: number): string => (BY_STACK.get(depth) ?? BY_STACK.get(nearestDepth(depth))!).id;

/** the default solution's id */
export const DEFAULT_SOLUTION = solutionId(DEFAULT_DEPTH);

/** the stack depth of a solution id (DEFAULT_DEPTH when it is not a shipped preflop solution) */
export const depthOf = (id: string | undefined): Depth => solutionEntry(id)?.stack ?? DEFAULT_DEPTH;

/** the build ID of a preflop solution ("" when the catalog does not know it) */
export const solutionBuild = (id: string): string => solutionEntry(id)?.build ?? "";
