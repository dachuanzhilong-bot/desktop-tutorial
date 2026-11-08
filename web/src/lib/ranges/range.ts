import { ALL_CLASSES, NUM_CLASSES, RANK_CHARS, classInfo } from "../poker/hands";
import { COMBOS } from "../postflop/combos";

/** A range is 169 weights (0..1), one per cell of the 13x13 chart. */
export type Range169 = Float32Array;

export const emptyRange = (): Range169 => new Float32Array(NUM_CLASSES);

export function rangeCombos(r: ArrayLike<number>): number {
  let s = 0;
  for (const c of ALL_CLASSES) s += c.combos * r[c.id];
  return s;
}
export const rangePercent = (r: ArrayLike<number>) => (rangeCombos(r) / 1326) * 100;

/** the 1,326-combo vector the solver wants */
export function expandToCombos(r: ArrayLike<number>): Float32Array {
  const out = new Float32Array(COMBOS.length);
  COMBOS.forEach((c, i) => (out[i] = r[c.cls]));
  return out;
}

// ---------------------------------------------------------------- text format ("AA,KK:0.5,A5s-A2s,JTs+")

const rankIdx = (ch: string) => RANK_CHARS.indexOf(ch.toUpperCase());

/** class id for two rank indices (0 = A) and a suit type */
function cell(hi: number, lo: number, kind: "pair" | "s" | "o"): number {
  if (kind === "pair") return hi * 13 + hi;
  return kind === "s" ? hi * 13 + lo : lo * 13 + hi;
}

interface Parsed {
  hi: number;
  lo: number;
  kind: "pair" | "s" | "o" | "both";
}

function parseHandToken(tok: string): Parsed | null {
  const m = /^([AKQJT98765432])([AKQJT98765432])([so])?$/i.exec(tok);
  if (!m) return null;
  const a = rankIdx(m[1]);
  const b = rankIdx(m[2]);
  if (a === b) return m[3] ? null : { hi: a, lo: a, kind: "pair" };
  const hi = Math.min(a, b);
  const lo = Math.max(a, b);
  const k = m[3]?.toLowerCase();
  return { hi, lo, kind: k === "s" ? "s" : k === "o" ? "o" : "both" };
}

function addCells(out: number[], p: Parsed) {
  if (p.kind === "pair") out.push(cell(p.hi, p.hi, "pair"));
  else if (p.kind === "both") out.push(cell(p.hi, p.lo, "s"), cell(p.hi, p.lo, "o"));
  else out.push(cell(p.hi, p.lo, p.kind));
}

/** expand one token (without weight) to class ids; returns null when it is not understood */
export function expandToken(tok: string): number[] | null {
  const out: number[] = [];
  const plus = /^(.+)\+$/.exec(tok);
  if (plus) {
    const p = parseHandToken(plus[1]);
    if (!p) return null;
    if (p.kind === "pair") for (let r = p.hi; r >= 0; r--) addCells(out, { hi: r, lo: r, kind: "pair" });
    else for (let lo = p.lo; lo > p.hi; lo--) addCells(out, { hi: p.hi, lo, kind: p.kind });
    return out;
  }
  const dash = /^([^-]+)-([^-]+)$/.exec(tok);
  if (dash) {
    const a = parseHandToken(dash[1]);
    const b = parseHandToken(dash[2]);
    if (!a || !b || a.kind !== b.kind) return null;
    if (a.kind === "pair") {
      for (let r = Math.min(a.hi, b.hi); r <= Math.max(a.hi, b.hi); r++) addCells(out, { hi: r, lo: r, kind: "pair" });
      return out;
    }
    if (a.hi === b.hi) {
      // A5s-A2s : same high card, a run of kickers
      for (let lo = Math.min(a.lo, b.lo); lo <= Math.max(a.lo, b.lo); lo++) addCells(out, { hi: a.hi, lo, kind: a.kind });
      return out;
    }
    if (a.lo - a.hi === b.lo - b.hi) {
      // JTs-54s : the same gap slid down
      const gap = a.lo - a.hi;
      for (let hi = Math.min(a.hi, b.hi); hi <= Math.max(a.hi, b.hi); hi++) addCells(out, { hi, lo: hi + gap, kind: a.kind });
      return out;
    }
    return null;
  }
  const p = parseHandToken(tok);
  if (!p) return null;
  addCells(out, p);
  return out;
}

export interface ParseResult {
  range: Range169;
  errors: string[];
}

export function parseRange(text: string): ParseResult {
  const range = emptyRange();
  const errors: string[] = [];
  for (const raw of text.split(/[,\s]+/).filter(Boolean)) {
    const [tok, w] = raw.split(":");
    let weight = 1;
    if (w !== undefined) {
      const x = Number(w.replace("%", ""));
      if (!Number.isFinite(x) || x < 0) {
        errors.push(raw);
        continue;
      }
      weight = x > 1 || w.includes("%") ? x / 100 : x;
    }
    const cells = expandToken(tok);
    if (!cells) {
      errors.push(raw);
      continue;
    }
    for (const c of cells) range[c] = Math.min(1, weight);
  }
  return { range, errors };
}

const fmtW = (w: number) => String(Math.round(w * 1000) / 1000);

/** compact text such as "99+,AKs-ATs,A5s-A2s:0.5": runs of equal weight are merged */
export function formatRange(r: ArrayLike<number>): string {
  const weights = [...new Set(Array.from({ length: NUM_CLASSES }, (_, i) => Math.round(r[i] * 1000) / 1000).filter((w) => w > 0))].sort((a, b) => b - a);
  const parts: string[] = [];
  for (const w of weights) {
    const has = (id: number) => Math.round(r[id] * 1000) / 1000 === w;
    const suffix = w < 1 ? `:${fmtW(w)}` : "";
    // pairs
    const pairs: number[] = [];
    for (let k = 0; k < 13; k++) if (has(k * 13 + k)) pairs.push(k);
    for (const run of runs(pairs)) {
      const top = RANK_CHARS[run[0]];
      const bot = RANK_CHARS[run[run.length - 1]];
      parts.push(run.length === 1 ? `${top}${top}${suffix}` : run[0] === 0 ? `${bot}${bot}+${suffix}` : `${top}${top}-${bot}${bot}${suffix}`);
    }
    for (const kind of ["s", "o"] as const) {
      for (let hi = 0; hi < 12; hi++) {
        const los: number[] = [];
        for (let lo = hi + 1; lo < 13; lo++) if (has(cell(hi, lo, kind))) los.push(lo);
        for (const run of runs(los)) {
          const name = (lo: number) => `${RANK_CHARS[hi]}${RANK_CHARS[lo]}${kind}`;
          if (run.length === 1) parts.push(name(run[0]) + suffix);
          else if (run[0] === hi + 1) parts.push(name(run[run.length - 1]) + "+" + suffix);
          else parts.push(`${name(run[0])}-${name(run[run.length - 1])}${suffix}`);
        }
      }
    }
  }
  return parts.join(",");
}

function runs(sorted: number[]): number[][] {
  const out: number[][] = [];
  for (const x of sorted) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === x - 1) last.push(x);
    else out.push([x]);
  }
  return out;
}

// ---------------------------------------------------------------- comparison

export interface Comparison {
  /** 0..100, combo-weighted Jaccard similarity */
  score: number;
  /** combos in the user's range that the reference does not contain (too wide) */
  extra: number;
  /** reference combos the user left out */
  missing: number;
}

export function compareRanges(user: ArrayLike<number>, ref: ArrayLike<number>): Comparison {
  let inter = 0;
  let union = 0;
  let extra = 0;
  let missing = 0;
  for (const c of ALL_CLASSES) {
    const a = user[c.id];
    const b = ref[c.id];
    inter += c.combos * Math.min(a, b);
    union += c.combos * Math.max(a, b);
    if (a > b) extra += c.combos * (a - b);
    else missing += c.combos * (b - a);
  }
  return { score: union > 0 ? (100 * inter) / union : 100, extra, missing };
}

export { classInfo };
