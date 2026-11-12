/**
 * Where a record belongs, without numbers that change when the solution data is generated again
 * (REFACTOR_PLAN step 1-3, docs/03 "局面キー" / "記録が持つ局面").
 *
 * A record (Attempt, SrsItem, an analysed decision, an item of a practice set) names its position by
 *   solution  `cash6max-<depth>bb` (pre-flop) or `post:<scenario>` (post-flop; no flop index)
 *   pos       pre-flop: the action line (lib/solution/positionKey.ts), e.g. `F-F-R2.5-F-F`
 *             post-flop: `<flop>@<line>` (lib/postflop/positionKey.ts), e.g. `As7d2c@X-B1.75-C/Td`
 *   build     build ID of the data it was answered against (informative: tells which data graded it)
 * The node id and, post-flop, the flop's index are looked up again from `pos` whenever they are needed.
 * Records made before this have no `pos`: for those the stored node id (and flop index) is still used.
 */
import { parseBoard } from "../postflop/combos";
import type { PfFlop } from "../postflop/decode";
import { flopKey, postflopKey, resolvePostflopKey } from "../postflop/positionKey";
import { preflopKey, resolvePreflopKey } from "../solution/positionKey";
import type { Manifest } from "../solution/types";
import type { Grade } from "./grading";
import { updateSrs } from "./srs";
import type { SrsIndex, SrsItem, SrsPosition } from "./srs";

export type PositionRef = SrsPosition;

/** between the flop and the line of a post-flop `pos`; neither part contains it (their characters: letters, digits, `.`, `-`, `/`) */
export const FLOP_SEP = "@";

/** `solution` of post-flop records made with a position key (older ones: `post:<scenario>/<flop index>`) */
export const postSolution = (scenario: string) => `post:${scenario}`;

/** scenario (and, in older records, the flop's index at that time) of a post-flop `solution`; null for anything else */
export function parsePostSolution(solution: string): { scenario: string; flopIndex: number | null } | null {
  const m = /^post:([\w-]+)(?:\/(\d+))?$/.exec(solution);
  return m ? { scenario: m[1], flopIndex: m[2] === undefined ? null : Number(m[2]) } : null;
}

/** the position of a pre-flop decision; `build` = SolutionStore.build */
export function preflopRef(m: Manifest, build: string | undefined, nodeId: number): PositionRef {
  return { solution: m.id, pos: preflopKey(m, nodeId), ...(build ? { build } : {}) };
}

/** `pos` of a node of a flop: the board and the line */
export const postflopPos = (flop: PfFlop, nodeId: number): string => `${flopKey(flop.board)}${FLOP_SEP}${postflopKey(flop, nodeId)}`;

/** the position of a post-flop decision; the build ID is the flop file's (PfFlop.build, set by loadFlop) */
export function postflopRef(scenario: string, flop: PfFlop, nodeId: number): PositionRef {
  return { solution: postSolution(scenario), pos: postflopPos(flop, nodeId), ...(flop.build ? { build: flop.build } : {}) };
}

/** the two parts of a post-flop `pos`, or null when it is not one */
export function splitPostflopPos(pos: string): { flop: string; line: string } | null {
  if (typeof pos !== "string") return null;
  const i = pos.indexOf(FLOP_SEP);
  if (i <= 0 || i === pos.length - 1 || pos.indexOf(FLOP_SEP, i + 1) >= 0) return null;
  return { flop: pos.slice(0, i), line: pos.slice(i + 1) };
}

/** today's index of a flop (by its board string, see flopKey) in the list of index.json, or -1 */
export function flopIndexOf(flops: readonly string[], flop: string): number {
  return flops.findIndex((text) => flopKey(parseBoard(text)) === flop);
}

/** a record with its position: `pos` and `build` are added, nothing else changes */
export function withPosition<T extends object>(record: T, ref: PositionRef): T & { pos: string; build?: string } {
  return { ...record, pos: ref.pos, ...(ref.build ? { build: ref.build } : {}) };
}

/**
 * The node a pre-flop record points at in manifest `m`: looked up from `pos` when the record has one (null when
 * this solution has no such decision), else the stored node id as before.
 */
export function currentPreflopNode(m: Manifest, rec: { pos?: string; nodeId: number }): number | null {
  return rec.pos === undefined ? rec.nodeId : resolvePreflopKey(m, rec.pos);
}

/** flop index of a post-flop record: from the board in `pos`, or the stored index of an older record; null when unknown */
export function currentFlopIndex(flops: readonly string[], rec: { solution: string; pos?: string }): { scenario: string; flopIndex: number } | null {
  const sol = parsePostSolution(rec.solution);
  if (!sol) return null;
  if (rec.pos === undefined) return sol.flopIndex === null ? null : { scenario: sol.scenario, flopIndex: sol.flopIndex };
  const parts = splitPostflopPos(rec.pos);
  const i = parts ? flopIndexOf(flops, parts.flop) : -1;
  return i < 0 ? null : { scenario: sol.scenario, flopIndex: i };
}

/** the node a post-flop record points at in `flop` (the flop found by currentFlopIndex); null when the tree has no such node */
export function currentPostflopNode(flop: PfFlop, rec: { pos?: string; nodeId: number }): number | null {
  if (rec.pos === undefined) return rec.nodeId;
  const parts = splitPostflopPos(rec.pos);
  return parts && parts.flop === flopKey(flop.board) ? resolvePostflopKey(flop, parts.line) : null;
}

/**
 * Spaced repetition after an answer: the item of (position, hand) is found by its position — an older item by
 * `legacyKey`, which it keeps — updated, put back into `index` and returned for saving.
 */
export function answerSrs(index: SrsIndex, ref: PositionRef, legacyKey: string, nodeId: number, hand: number, grade: Grade, now: number): SrsItem {
  const item = updateSrs(index.find(ref.solution, ref.pos, hand, legacyKey), nodeId, hand, grade, now, undefined, ref);
  index.put(item);
  return item;
}
