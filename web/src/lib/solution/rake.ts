/**
 * The rake a preflop solution was solved with (REFACTOR_PLAN 3-2, solver/src/rake.rs, docs/03).
 *
 * The house takes `pct`% of the pot of a hand that sees the flop, at most `cap` bb (null: no cap); a hand that ends
 * before the flop pays nothing ("no flop, no drop"). Manifests and catalog entries made before rake existed have no
 * `rake` field: they are solutions without rake, and stay readable as such.
 */
export interface Rake {
  /** % of the pot (0 = no rake) */
  pct: number;
  /** at most this many bb; null = no cap */
  cap: number | null;
}

export const NO_RAKE: Readonly<Rake> = Object.freeze({ pct: 0, cap: null });

/**
 * The `rake` field of a manifest or catalog entry: missing (the format before rake) or not a valid rake -> no rake.
 * The solver writes it only with rake (`{"pct":5,"cap":3}`, `"cap":null` without cap).
 */
export function readRake(raw: unknown): Rake {
  if (typeof raw !== "object" || raw === null) return NO_RAKE;
  const { pct, cap } = raw as { pct?: unknown; cap?: unknown };
  if (typeof pct !== "number" || !(pct > 0 && pct < 100)) return NO_RAKE;
  if (cap === null || cap === undefined) return { pct, cap: null };
  return typeof cap === "number" && cap >= 0 ? { pct, cap } : NO_RAKE;
}

/**
 * A short, stable name of a rake, for the settings (`Settings.rake`) and as a React key: "0" without rake,
 * otherwise "<pct>/<cap>" ("5/3"; "5/-" without cap). It is not a solution id (those come from the catalog only).
 */
export const rakeKey = (r: Rake): string => (r.pct > 0 ? `${r.pct}/${r.cap ?? "-"}` : "0");

/** the key of "no rake" (the default setting, and every solution made before rake existed) */
export const NO_RAKE_KEY = rakeKey(NO_RAKE);
