import type { Key } from "../i18n/ja";

/**
 * The parser / normaliser / matcher report why a hand is not analysed as a short English string (also stored
 * with imported hands). This maps every such string to a translated sentence; anything unknown is shown as is.
 */
const EXACT: Record<string, Key> = {
  "no hand header": "analyze.r.header",
  "tournament hands are not supported": "analyze.r.tournament",
  "only No-Limit Hold'em is supported": "analyze.r.game",
  "stakes not found": "analyze.r.stakes",
  "table line not found": "analyze.r.table",
  "fewer than two players": "analyze.r.players",
  "fewer than two active players": "analyze.r.players",
  "run-it-twice hands are not supported": "analyze.r.rit",
  "no blinds posted": "analyze.r.blinds",
  "small or big blind missing": "analyze.r.blinds",
  "hero cards not found": "analyze.r.hero",
  "hero is not an active player": "analyze.r.hero",
  "more than six players (only 6-max positions are supported)": "analyze.r.sixMax",
  "blind posters are not seated": "analyze.r.seats",
  "could not order the seats": "analyze.r.seats",
  "the action order differs from the solution": "analyze.r.order",
  "file too large": "analyze.r.tooLarge",
};

const PATTERNS: [RegExp, Key, (m: RegExpExecArray) => Record<string, string>][] = [
  [/^effective stack (\d+)bb is outside (\d+)-(\d+)bb$/, "analyze.r.stack", (m) => ({ n: m[1], min: m[2], max: m[3] })],
  [/^(fold|check|call|bet|raise) is not part of the solution at this point$/, "analyze.r.offTree", (m) => ({ act: m[1] })],
  [/^could not parse \((.*)\)$/, "analyze.r.parse", (m) => ({ msg: m[1] })],
  [/^internal error \((.*)\)$/, "analyze.r.internal", (m) => ({ msg: m[1] })],
];

export function reasonText(reason: string, t: (k: Key, p?: Record<string, string | number>) => string): string {
  const k = EXACT[reason];
  if (k) return t(k);
  for (const [re, key, params] of PATTERNS) {
    const m = re.exec(reason);
    if (m) return t(key, params(m));
  }
  return reason;
}
