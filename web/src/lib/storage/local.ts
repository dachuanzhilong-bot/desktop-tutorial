/**
 * Small values kept in localStorage (settings, unsaved drafts) with a schema version.
 *
 * Every stored object carries `_v` (the schema version it was written with). Reading:
 *   1. parse (corrupt JSON -> nothing stored)
 *   2. objects without `_v` are version 1 (everything written before versioning)
 *   3. run migrations[n] for n = stored .. current-1, one step at a time
 *   4. sanitize: keep only fields of the right type and range, fill the rest with defaults
 * so an old, partial, hand-edited or newer-than-this-app value never crashes a screen.
 */

export const VERSION_FIELD = "_v";

type Obj = Record<string, unknown>;

export interface LocalSchema<T> {
  key: string;
  /** current schema version (>= 1) */
  version: number;
  /** migrations[n] turns version-n data into version n+1 */
  migrations?: Record<number, (d: Obj) => Obj>;
  /** build a valid value from whatever fields survived (must not throw) */
  sanitize: (d: Obj) => T;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Store | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // e.g. blocked storage in a sandboxed iframe
  }
}

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** migrate + sanitize a parsed value (exported for tests) */
export function upgrade<T>(schema: LocalSchema<T>, raw: unknown): T | null {
  if (!isObj(raw)) return null;
  let v = Number(raw[VERSION_FIELD]);
  if (!Number.isInteger(v) || v < 1) v = 1;
  let d: Obj = { ...raw };
  for (; v < schema.version; v++) {
    const step = schema.migrations?.[v];
    if (step) d = step(d);
  }
  delete d[VERSION_FIELD];
  return schema.sanitize(d);
}

export function readLocal<T>(schema: LocalSchema<T>, store: Store | null = storage()): T | null {
  try {
    const raw = store?.getItem(schema.key);
    if (!raw) return null;
    return upgrade(schema, JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeLocal<T extends object>(schema: LocalSchema<T>, value: T, store: Store | null = storage()): boolean {
  try {
    store?.setItem(schema.key, JSON.stringify({ ...value, [VERSION_FIELD]: schema.version }));
    return !!store;
  } catch {
    return false; // quota / private mode: the value just does not persist
  }
}

// ---- field validators used by the sanitizers ----

export const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
export const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
export const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
export const int = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number => (Number.isInteger(v) ? num(v, fallback, min, max) : fallback);
export const str = (v: unknown, fallback: string, maxLen = 20_000): string => (typeof v === "string" ? v.slice(0, maxLen) : fallback);
