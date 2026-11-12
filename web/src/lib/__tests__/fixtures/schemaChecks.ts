import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The `check` constraints of supabase/schema.sql, read from the file itself, so that the fake servers in the tests
 * (Vitest and Playwright) refuse exactly what a real Postgres would. A fake with its own copy of the limits cannot
 * notice that the schema is wrong: the post-flop sync bug (`hand between 0 and 168`) passed every test that way.
 *
 * Only what the app's tables use is understood: `<col> between A and B`, `<col> in (...)` and `<col> >= N`.
 * Anything else makes `schemaChecks` throw, so a new kind of constraint is noticed instead of silently ignored.
 */
export const SCHEMA_PATH = path.resolve(__dirname, "../../../../../supabase/schema.sql");

export interface Check {
  /** Postgres names an inline column check `<table>_<column>_check` */
  name: string;
  column: string;
  /** the rule as written in the SQL, e.g. "hand between 0 and 1325" */
  rule: string;
  test: (value: unknown) => boolean;
}

export const readSchema = () => readFileSync(SCHEMA_PATH, "utf8");

/** the text between the parentheses that open at `open` (the index of "(") and their match */
function balanced(sql: string, open: number): { inner: string; end: number } {
  let depth = 0;
  let quote = false;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (!quote && c === "-" && sql[i + 1] === "-") i = Math.max(i, sql.indexOf("\n", i) - 1); // a comment runs to the end of its line
    else if (c === "'") quote = !quote;
    else if (!quote && c === "(") depth++;
    else if (!quote && c === ")" && --depth === 0) return { inner: sql.slice(open + 1, i), end: i };
  }
  throw new Error("unbalanced parentheses in the schema");
}

function literal(token: string): string | number {
  const t = token.trim();
  if (/^'.*'$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  throw new Error(`unsupported literal in a check: ${t}`);
}

/** one check expression, e.g. "hand between 0 and 1325" */
export function parseCheck(name: string, expr: string): Check {
  const rule = expr.trim().replace(/\s+/g, " ");
  let m = /^(\w+) between (-?\d+(?:\.\d+)?) and (-?\d+(?:\.\d+)?)$/.exec(rule);
  if (m) {
    const [, column, lo, hi] = m;
    return { name, column, rule, test: (v) => v == null || (typeof v === "number" && v >= Number(lo) && v <= Number(hi)) };
  }
  m = /^(\w+) in \((.+)\)$/.exec(rule);
  if (m) {
    const [, column, list] = m;
    const allowed = list.split(",").map(literal);
    return { name, column, rule, test: (v) => v == null || allowed.includes(v as string | number) };
  }
  m = /^(\w+) >= (-?\d+(?:\.\d+)?)$/.exec(rule);
  if (m) {
    const [, column, lo] = m;
    return { name, column, rule, test: (v) => v == null || (typeof v === "number" && v >= Number(lo)) };
  }
  throw new Error(`unsupported check in the schema: ${rule}`);
}

/** the inline column checks of `create table ... public.<table> (...)` */
export function schemaChecks(table: string, sql = readSchema()): Check[] {
  const head = new RegExp(`create table if not exists public\\.${table}\\s*\\(`).exec(sql);
  if (!head) throw new Error(`table ${table} is not in the schema`);
  const body = balanced(sql, head.index + head[0].length - 1).inner;
  const checks: Check[] = [];
  for (const line of body.split("\n")) {
    const column = /^\s*(\w+)\s+\w+/.exec(line)?.[1];
    const at = line.indexOf("check (");
    if (!column || at < 0 || /^\s*(unique|primary|check|constraint)\b/.test(line)) continue;
    const { inner } = balanced(line, at + "check ".length);
    checks.push(parseCheck(`${table}_${column}_check`, inner));
  }
  return checks;
}

/** the checks that `alter table public.<table> add constraint <name> check (...)` statements (the fix for existing databases) leave in place */
export function migrationChecks(table: string, sql = readSchema()): Check[] {
  const checks: Check[] = [];
  const pattern = new RegExp(`alter table public\\.${table}\\s+add constraint (\\w+) check \\(`, "g");
  for (let m = pattern.exec(sql); m; m = pattern.exec(sql)) checks.push(parseCheck(m[1], balanced(sql, m.index + m[0].length - 1).inner));
  return checks;
}

/** the constraints a row breaks, as Postgres words them ("violates check constraint ..."); empty when the row is fine */
export function violations(checks: Check[], row: Record<string, unknown>): string[] {
  return checks.filter((c) => !c.test(row[c.column])).map((c) => `${c.name}: ${c.rule}`);
}

/**
 * What PostgREST answers to a batch insert: nothing is stored when any row breaks a constraint.
 * `null` when every row passes, otherwise the 400 body.
 */
export function rejectBatch(table: string, checks: Check[], rows: Record<string, unknown>[]): { code: string; message: string } | null {
  for (const row of rows) {
    const broken = checks.find((c) => !c.test(row[c.column]));
    if (broken) return { code: "23514", message: `new row for relation "${table}" violates check constraint "${broken.name}"` };
  }
  return null;
}
