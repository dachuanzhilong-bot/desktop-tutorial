/**
 * Where a record belongs, without numbers that change when the solution data is generated again
 * (REFACTOR_PLAN step 1-3, docs/03 "局面キー" / "記録が持つ局面").
 *
 * A record (Attempt, SrsItem, an analysed decision, an item of a practice set) names its position by
 *   solution  pre-flop: the solution id of the catalog (lib/solution/catalog.ts, one per stack depth);
 *             post-flop: `post:<scenario>` (no flop index)
 *   pos       pre-flop: the action line (lib/solution/positionKey.ts), e.g. `F-F-R2.5-F-F`
 *             post-flop: `<flop>@<line>` (lib/postflop/positionKey.ts), e.g. `As7d2c@X-B1.75-C/Td`
 *   build     build ID of the data it was answered against (informative: tells which data graded it)
 * The node id and, post-flop, the flop's index are looked up again from `pos` whenever they are needed.
 * Every record has a `pos`: the ones made before position keys were deleted (REFACTOR_PLAN step 1-4, lib/storage/obsolete.ts).
 */
import { parseBoard } from "../postflop/combos";
import type { PfFlop } from "../postflop/decode";
import { flopKey, postflopKey, resolvePostflopKey } from "../postflop/positionKey";
import { preflopKey, resolvePreflopKey, ROOT_KEY } from "../solution/positionKey";
import type { Manifest } from "../solution/types";
import type { Grade } from "./grading";
import { updateSrs } from "./srs";
import type { SrsIndex, SrsItem, SrsPosition } from "./srs";

export type PositionRef = SrsPosition;

/** between the flop and the line of a post-flop `pos`; neither part contains it (their characters: letters, digits, `.`, `-`, `/`) */
export const FLOP_SEP = "@";

/** `solution` of post-flop records: the scenario, without a flop index (the flop is in `pos`) */
export const postSolution = (scenario: string) => `post:${scenario}`;

/** scenario of a post-flop `solution`; null for anything else */
export function parsePostSolution(solution: string): { scenario: string } | null {
  const m = /^post:([\w-]+)$/.exec(solution);
  return m ? { scenario: m[1] } : null;
}

/** the position of a pre-flop decision; `build` = SolutionStore.build */
export function preflopRef(m: Manifest, build: string | undefined, nodeId: number): PositionRef {
  return { solution: m.id, pos: preflopKey(m, nodeId), ...(build ? { build } : {}) };
}

/** `pos` of a node of a flop: the board and the line */
export const postflopPos = (flop: PfFlop, nodeId: number): string => `${flopKey(flop.board)}${FLOP_SEP}${postflopKey(flop, nodeId)}`;

/** `pos` of a flop's first decision, from its board alone (no need to load the flop) */
export const flopRootPos = (board: readonly number[]): string => `${flopKey(board)}${FLOP_SEP}${ROOT_KEY}`;

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

/** the node a pre-flop record points at in manifest `m`: looked up from `pos`; null when this solution has no such decision */
export function currentPreflopNode(m: Manifest, rec: { pos: string }): number | null {
  return resolvePreflopKey(m, rec.pos);
}

/** today's flop index of a post-flop record, from the board in `pos`; null when it is not a post-flop record or the flop is not there */
export function currentFlopIndex(flops: readonly string[], rec: { solution: string; pos: string }): { scenario: string; flopIndex: number } | null {
  const sol = parsePostSolution(rec.solution);
  if (!sol) return null;
  const parts = splitPostflopPos(rec.pos);
  const i = parts ? flopIndexOf(flops, parts.flop) : -1;
  return i < 0 ? null : { scenario: sol.scenario, flopIndex: i };
}

/** the node a post-flop record points at in `flop` (the flop found by currentFlopIndex); null when the tree has no such node */
export function currentPostflopNode(flop: PfFlop, rec: { pos: string }): number | null {
  const parts = splitPostflopPos(rec.pos);
  return parts && parts.flop === flopKey(flop.board) ? resolvePostflopKey(flop, parts.line) : null;
}

/** spaced repetition after an answer: the item of (position, hand) is updated, put back into `index` and returned for saving */
export function answerSrs(index: SrsIndex, ref: PositionRef, nodeId: number, hand: number, grade: Grade, now: number): SrsItem {
  const item = updateSrs(index.find(ref.solution, ref.pos, hand), ref, nodeId, hand, grade, now);
  index.put(item);
  return item;
}
