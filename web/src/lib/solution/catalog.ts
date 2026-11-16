/**
 * The catalog of the shipped preflop solutions (REFACTOR_PLAN step 2-4, ARCHITECTURE problem F).
 *
 * public/solutions/index.json is the one list of what is shipped: scripts/pack-solutions.mjs writes it from the
 * manifests (id, game, players, stack, rake) and scripts/build-id.mjs adds the build IDs. Like the postflop index
 * (lib/postflop/loader.ts PF_INDEX) it is part of the build, not fetched: the app and the data it asks for always
 * belong together. The depth list, the solution ids and "is this a preflop solution" all come from here; no other
 * file spells a solution id out.
 *
 * A solution is chosen by its stack depth and its rake (REFACTOR_PLAN 3-2). Today there is one solution per stack
 * depth, all without rake (entries made before rake existed have no `rake` field: no rake); the data test checks
 * that no two solutions share a depth and a rake. The rake choice is offered only where one depth has solutions
 * with two or more rakes (`rakeOptions`).
 * Solution ids are what records store (`Attempt.solution`), so they never change their meaning.
 */
import indexJson from "../../../public/solutions/index.json";
import { NO_RAKE_KEY, Rake, rakeKey, readRake } from "./rake";

/** an entry of index.json as pack-solutions.mjs writes it (`rake` only for a solution with rake) */
export interface IndexEntry {
  id: string;
  game: string;
  players: number;
  stack: number;
  build: string;
  files: string[];
  rake?: unknown;
}

export interface SolutionEntry {
  /** directory name and record value, e.g. the 100bb cash solution */
  id: string;
  /** "cash": the preflop solver has no tournament model */
  game: string;
  /** number of seats (manifest.players.length) */
  players: number;
  /** effective stack depth in bb (manifest.stack) */
  stack: number;
  /** the rake it was solved with (manifest.rake; no rake when the entry has none) */
  rake: Rake;
  /** build ID of the packed files (scripts/build-id.mjs) */
  build: string;
  /** packed files, for the service worker's precache */
  files: string[];
}

export type Depth = number;

export interface Catalog {
  /** every solution, shallowest first (no rake first within a depth, then by rate and cap) */
  solutions: readonly SolutionEntry[];
  /** effective stack depths (bb) a preflop solution exists for, ascending, each once */
  depths: readonly Depth[];
  nearestDepth: (stack: number) => Depth;
  entry: (id: string | undefined) => SolutionEntry | undefined;
  /** the id of the solution at a depth (a depth that is not shipped: the nearest one) with the rake of `rake`
   *  (`rakeKey`); without a solution with that rake there, the one without rake (or the lowest rake) */
  solutionId: (depth: number, rake?: string) => string;
  /** the rakes the solutions at a depth (a table like its default solution's: game, seats) were solved with */
  rakeOptions: (depth: number) => Rake[];
  /** what the rake picker offers at a depth: its rake options when there are two or more, otherwise none (the
   *  picker is not shown) */
  rakeChoices: (depth: number) => Rake[];
}

const capOrder = (r: Rake) => r.cap ?? Infinity;

/** the catalog of a list of index entries (the shipped one below; tests make others) */
export function makeCatalog(list: readonly IndexEntry[]): Catalog {
  const solutions: SolutionEntry[] = list
    .map(({ id, game, players, stack, build, files, rake }) => ({ id, game, players, stack, rake: readRake(rake), build, files }))
    .sort((a, b) => a.stack - b.stack || a.rake.pct - b.rake.pct || capOrder(a.rake) - capOrder(b.rake));
  const byId = new Map<string, SolutionEntry>(solutions.map((s) => [s.id, s]));
  const byStack = new Map<number, SolutionEntry[]>();
  for (const s of solutions) byStack.set(s.stack, [...(byStack.get(s.stack) ?? []), s]);
  const depths: Depth[] = [...byStack.keys()];

  /** the depth whose solution is closest to an effective stack (compared on a log scale: 70bb is nearer 60 than 100) */
  const nearestDepth = (stack: number): Depth => {
    let best: Depth = depths[0];
    let d = Infinity;
    for (const x of depths) {
      const e = Math.abs(Math.log(Math.max(stack, 1) / x));
      if (e < d) {
        d = e;
        best = x;
      }
    }
    return best;
  };
  const at = (depth: number): SolutionEntry[] => byStack.get(depth) ?? byStack.get(nearestDepth(depth))!;
  /** the solution of a depth when no rake is asked for: the one without rake, else the lowest rake */
  const base = (depth: number) => at(depth).find((s) => s.rake.pct === 0) ?? at(depth)[0];
  const sameTable = (a: SolutionEntry, b: SolutionEntry) => a.game === b.game && a.players === b.players;

  const rakeOptions = (depth: number): Rake[] => {
    const b = base(depth);
    return at(depth)
      .filter((s) => sameTable(s, b))
      .map((s) => s.rake);
  };
  return {
    solutions,
    depths,
    nearestDepth,
    entry: (id) => (id === undefined ? undefined : byId.get(id)),
    solutionId: (depth, rake = NO_RAKE_KEY) => {
      const b = base(depth);
      return (at(depth).find((s) => sameTable(s, b) && rakeKey(s.rake) === rake) ?? b).id;
    },
    rakeOptions,
    rakeChoices: (depth) => {
      const o = rakeOptions(depth);
      return o.length >= 2 ? o : [];
    },
  };
}

const CATALOG = makeCatalog(indexJson.solutions);

/** every shipped preflop solution, shallowest first */
export const SOLUTIONS: readonly SolutionEntry[] = CATALOG.solutions;

/** effective stack depths (bb) a preflop solution exists for, ascending */
export const DEPTHS: readonly number[] = CATALOG.depths;

/** the depth whose solution is closest to an effective stack (compared on a log scale: 70bb is nearer 60 than 100) */
export const nearestDepth = (stack: number): Depth => CATALOG.nearestDepth(stack);

/** the depth the app starts with: the usual 100bb cash game, or the shipped depth nearest to it */
export const DEFAULT_DEPTH: Depth = nearestDepth(100);

/** the catalog entry of a solution id, or undefined when it is not shipped (an old record, a post-flop id) */
export const solutionEntry = (id: string | undefined): SolutionEntry | undefined => CATALOG.entry(id);

/** whether `id` names a shipped preflop solution */
export const isPreflopSolution = (id: string | undefined): boolean => solutionEntry(id) !== undefined;

/** the id of the solution at a shipped depth (a depth that is not shipped gets the nearest one's), with the rake
 *  `rake` (`rakeKey`; default: no rake) when that depth has a solution with it */
export const solutionId = (depth: number, rake?: string): string => CATALOG.solutionId(depth, rake);

/** the rakes the shipped solutions at a depth were solved with (the picker shows when there are two or more) */
export const rakeOptions = (depth: number): Rake[] => CATALOG.rakeOptions(depth);

/** the rakes the picker offers at a depth (none, and no picker, unless the depth has two or more) */
export const rakeChoices = (depth: number): Rake[] => CATALOG.rakeChoices(depth);

/** the default solution's id */
export const DEFAULT_SOLUTION = solutionId(DEFAULT_DEPTH);

/** the stack depth of a solution id (DEFAULT_DEPTH when it is not a shipped preflop solution) */
export const depthOf = (id: string | undefined): Depth => solutionEntry(id)?.stack ?? DEFAULT_DEPTH;

/** the rake key (`rakeKey`) of a solution id (no rake when it is not a shipped preflop solution) */
export const rakeOf = (id: string | undefined): string => {
  const e = solutionEntry(id);
  return e ? rakeKey(e.rake) : NO_RAKE_KEY;
};

/** the build ID of a preflop solution ("" when the catalog does not know it) */
export const solutionBuild = (id: string): string => solutionEntry(id)?.build ?? "";
