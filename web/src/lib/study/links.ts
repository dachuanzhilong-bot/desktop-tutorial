/**
 * Deep links into the Study screens (app paths; <Link> adds the hosting sub-path itself).
 *
 * A link names its position by a position key (docs/03 "局面キー"), never by a number that changes when the solution
 * data is generated again:
 *   pre-flop   /study/#d=<depth>&p=<line>[&h=<hand class>]        e.g. #d=100&p=F-F-R2.5-F-F&h=14
 *   post-flop  /study/postflop/#s=<scenario>&p=<flop>@<line>      e.g. #s=srp-btn-bb&p=QsJd6s@X-B1.75-C/Td
 * The Study screens look the key up in the data they have loaded; a key that data does not have opens the root.
 *
 * Addresses written before position keys (`n=<number>`, post-flop `f=<flop number>`) are still read, because hand-typed
 * and shared addresses of that form exist — but only read: nothing in the app writes or stores them, and a saved
 * position must have `p=` (isPositionHref).
 */
import type { PfFlop } from "../postflop/decode";
import { resolvePostflopKey } from "../postflop/positionKey";
import { flopIndexOf, splitPostflopPos } from "../practice/position";
import { resolvePreflopKey } from "../solution/positionKey";
import type { Manifest } from "../solution/types";

export const preflopLink = (depth: number, pos: string, hand: number | null = null): string => `/study/#d=${depth}&p=${pos}${hand === null ? "" : `&h=${hand}`}`;
/** `pos` = `<flop>@<line>` (lib/practice/position.ts: postflopPos) */
export const postflopLink = (scenario: string, pos: string): string => `/study/postflop/#s=${scenario}&p=${pos}`;

/** the "#…" part of a link: what the Study screens keep in the address bar */
export const preflopHash = (depth: number, pos: string, hand: number | null): string => preflopLink(depth, pos, hand).slice("/study/".length);
export const postflopHash = (scenario: string, pos: string): string => postflopLink(scenario, pos).slice("/study/postflop/".length);

const params = (hash: string) => new URLSearchParams(hash.replace(/^#/, ""));
/** a non-negative whole number of an address, or null */
const count = (v: string | null): number | null => (v !== null && /^\d+$/.test(v) ? Number(v) : null);

/** what a pre-flop Study address asks for; `number` is the `n=` of an address written before position keys */
export interface PreflopTarget {
  depth: number | null;
  pos: string | null;
  number: number | null;
  /** the hand class to open on the chart (0..168) */
  hand: number | null;
}

export function parsePreflopHash(hash: string): PreflopTarget {
  const p = params(hash);
  const hand = count(p.get("h"));
  return { depth: count(p.get("d")), pos: p.get("p") || null, number: count(p.get("n")), hand: hand !== null && hand < 169 ? hand : null };
}

/**
 * The node of manifest `m` a pre-flop address opens: the one its position key has today, or the root when this
 * solution has no such position. An old address is taken by its number (when the solution has that many nodes).
 * null = the address names no position: the view stays where it is.
 */
export function preflopTarget(m: Manifest, want: Pick<PreflopTarget, "pos" | "number">): number | null {
  if (want.pos !== null) return resolvePreflopKey(m, want.pos) ?? 0;
  return want.number !== null && want.number < m.nodes.length ? want.number : null;
}

/** what a post-flop Study address asks for; `flopNumber` / `number` are the `f=` / `n=` of an address written before position keys */
export interface PostflopTarget {
  /** a solve made on the Solve screen (#solve=<id>) */
  solve: string | null;
  scenario: string | null;
  pos: string | null;
  flopNumber: number | null;
  number: number | null;
}

export function parsePostflopHash(hash: string): PostflopTarget {
  const p = params(hash);
  return { solve: p.get("solve") || null, scenario: p.get("s") || null, pos: p.get("p") || null, flopNumber: count(p.get("f")), number: count(p.get("n")) };
}

/**
 * The flop a post-flop address opens, as today's index in `flops` (the board texts of index.json), and the line to
 * look up once that flop is loaded. A flop today's data does not have gives the first flop at its root. null = the
 * address names no flop.
 */
export function postflopTargetFlop(flops: readonly string[], want: PostflopTarget): { flopIndex: number; line: string | null; number: number | null } | null {
  if (want.pos !== null) {
    const parts = splitPostflopPos(want.pos);
    const i = parts ? flopIndexOf(flops, parts.flop) : -1;
    return i < 0 ? { flopIndex: 0, line: null, number: null } : { flopIndex: i, line: parts!.line, number: null };
  }
  if (want.flopNumber === null && want.number === null) return null;
  return { flopIndex: Math.min(want.flopNumber ?? 0, Math.max(0, flops.length - 1)), line: null, number: want.number };
}

/** the node of `flop` a line (the part of `pos` after the flop) names today; the root when the tree has no such node */
export const postflopTarget = (flop: PfFlop, line: string): number => resolvePostflopKey(flop, line) ?? 0;

const POSITION_HREF = /^\/study\/(postflop\/)?#[\w=&.@/-]*$/;

/** an address a saved position may have: a Study screen, with a position key (addresses that hold numbers are not kept) */
export function isPositionHref(href: unknown): href is string {
  if (typeof href !== "string" || !POSITION_HREF.test(href)) return false;
  const p = params(href.slice(href.indexOf("#")));
  return !!p.get("p") && !p.has("n") && !p.has("f");
}
