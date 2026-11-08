/**
 * PokerStars cash-game hand-history parser (No-Limit Hold'em).
 *
 * Understands: blinds/antes, all actions (incl. "and is all-in"), uncalled bets, board per street, shown hands and
 * collected pots, real-money and play-money formats, Zoom ("PokerStars Zoom Hand"), CRLF/BOM, many hands per file.
 * It does not understand tournaments, other games or run-it-twice: those hands are reported in `skipped` with a reason.
 */
export type ActionKind = "fold" | "check" | "call" | "bet" | "raise";

export interface ParsedAction {
  /** 0 preflop, 1 flop, 2 turn, 3 river */
  street: number;
  player: string;
  kind: ActionKind;
  /** chips put in by this action (call amount, bet size, or raise increment) */
  amount: number;
  /** raise: total bet on this street after the raise; bet: = amount; call: = amount (not used) */
  to: number;
  allIn: boolean;
}

export interface ParsedPlayer {
  seat: number;
  name: string;
  stack: number;
  sittingOut: boolean;
}

export interface ParsedHand {
  site: "pokerstars";
  id: string;
  /** milliseconds since the epoch (the time zone of the file is unknown, so this is approximate) */
  ts: number;
  sb: number;
  bb: number;
  ante: number;
  currency: string;
  tableSize: number;
  buttonSeat: number;
  players: ParsedPlayer[];
  hero: string | null;
  heroCards: [string, string] | null;
  /** blinds and antes posted, in order: [player, chips, kind] */
  posts: { player: string; amount: number; kind: "sb" | "bb" | "both" | "ante" }[];
  actions: ParsedAction[];
  /** board cards in order (up to 5), e.g. ["2c","7d","Ts"] */
  board: string[];
  /** chips collected by each player (sum over pots) */
  collected: Record<string, number>;
  /** uncalled bet returned: [player, chips] */
  uncalled: { player: string; amount: number }[];
  /** hands shown at showdown */
  shown: Record<string, [string, string]>;
  raw: string;
}

export interface Skipped {
  id: string | null;
  reason: string;
}

export interface ParseResult {
  hands: ParsedHand[];
  skipped: Skipped[];
  /** how many "PokerStars Hand #" blocks the text contained (0 = not a PokerStars history) */
  blocks: number;
}

const num = (s: string) => Number(s.replace(/[,$€£\s]/g, ""));
const MONEY = String.raw`[$€£]?[\d.,]+`;
const CARD = String.raw`[2-9TJQKA][cdhs]`;

function splitHands(text: string): string[] {
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const parts = t.split(/\n(?=PokerStars (?:Zoom )?Hand #)/);
  return parts.map((p) => p.trim()).filter((p) => /^PokerStars (?:Zoom )?Hand #/.test(p));
}

function parseDate(s: string | undefined): number {
  const m = s && /(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
}

function parseOne(block: string): ParsedHand | Skipped {
  const lines = block.split("\n").map((l) => l.trimEnd());
  const head = /^PokerStars (?:Zoom )?Hand #(\d+):\s*(.*)$/.exec(lines[0]);
  if (!head) return { id: null, reason: "no hand header" };
  const id = head[1];
  const rest = head[2];
  if (/Tournament/i.test(rest) || /^Tournament/.test(lines[0])) return { id, reason: "tournament hands are not supported" };
  if (!/Hold'em No Limit/i.test(rest)) return { id, reason: "only No-Limit Hold'em is supported" };
  const stakes = new RegExp(String.raw`\((${MONEY})\/(${MONEY})(?: ([A-Z]{3}))?\)`).exec(rest);
  if (!stakes) return { id, reason: "stakes not found" };
  const sb = num(stakes[1]);
  const bb = num(stakes[2]);
  const currency = stakes[3] ?? (/[$]/.test(stakes[1]) ? "USD" : /€/.test(stakes[1]) ? "EUR" : /£/.test(stakes[1]) ? "GBP" : "play");
  const ts = parseDate(rest);

  const table = /^Table '.*' (\d+)-max Seat #(\d+) is the button/.exec(lines[1] ?? "");
  if (!table) return { id, reason: "table line not found" };
  const tableSize = Number(table[1]);
  const buttonSeat = Number(table[2]);

  // ---- seats
  const players: ParsedPlayer[] = [];
  let i = 2;
  for (; i < lines.length; i++) {
    const m = new RegExp(String.raw`^Seat (\d+): (.+) \((${MONEY}) in chips\)(.*)$`).exec(lines[i]);
    if (!m) break;
    players.push({ seat: Number(m[1]), name: m[2], stack: num(m[3]), sittingOut: /sitting out/.test(m[4]) });
  }
  if (players.length < 2) return { id, reason: "fewer than two players" };
  const names = players.map((p) => p.name).sort((a, b) => b.length - a.length);
  const split = (line: string): [string, string] | null => {
    for (const n of names) if (line.startsWith(n + ": ")) return [n, line.slice(n.length + 2)];
    return null;
  };

  const out: ParsedHand = {
    site: "pokerstars",
    id,
    ts,
    sb,
    bb,
    ante: 0,
    currency,
    tableSize,
    buttonSeat,
    players,
    hero: null,
    heroCards: null,
    posts: [],
    actions: [],
    board: [],
    collected: {},
    uncalled: [],
    shown: {},
    raw: block,
  };

  let street = -1; // before HOLE CARDS
  let stop = false;
  for (; i < lines.length && !stop; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("*** HOLE CARDS ***")) {
      street = 0;
      continue;
    }
    if (line.startsWith("*** FIRST FLOP") || line.startsWith("*** SECOND")) return { id, reason: "run-it-twice hands are not supported" };
    const st = /^\*\*\* (FLOP|TURN|RIVER) \*\*\* \[([^\]]*)\](?: \[([^\]]*)\])?/.exec(line);
    if (st) {
      street = st[1] === "FLOP" ? 1 : st[1] === "TURN" ? 2 : 3;
      if (street === 1) out.board = st[2].split(" ");
      else out.board = [...out.board.slice(0, street + 2), ...(st[3] ?? "").split(" ").filter(Boolean)].slice(0, street + 2);
      continue;
    }
    if (line.startsWith("*** SHOW DOWN ***")) {
      street = 4;
      continue;
    }
    if (line.startsWith("*** SUMMARY ***")) {
      stop = true;
      continue;
    }
    const dealt = new RegExp(String.raw`^Dealt to (.+) \[(${CARD}) (${CARD})\]`).exec(line);
    if (dealt) {
      if (out.hero === null) {
        out.hero = dealt[1];
        out.heroCards = [dealt[2], dealt[3]];
      }
      continue;
    }
    const unc = new RegExp(String.raw`^Uncalled bet \((${MONEY})\) returned to (.+)$`).exec(line);
    if (unc) {
      out.uncalled.push({ player: unc[2], amount: num(unc[1]) });
      continue;
    }
    const col = new RegExp(String.raw`^(.+) collected (${MONEY}) from (?:main |side )?pot`).exec(line);
    if (col) {
      out.collected[col[1]] = (out.collected[col[1]] ?? 0) + num(col[2]);
      continue;
    }
    const sp = split(line);
    if (!sp) continue; // chat, "has timed out", "Table ... removed", ...
    const [player, what] = sp;
    let m: RegExpExecArray | null;
    if ((m = new RegExp(String.raw`^posts small blind (${MONEY})`).exec(what))) out.posts.push({ player, amount: num(m[1]), kind: "sb" });
    else if ((m = new RegExp(String.raw`^posts big blind (${MONEY})`).exec(what))) out.posts.push({ player, amount: num(m[1]), kind: "bb" });
    else if ((m = new RegExp(String.raw`^posts small & big blinds (${MONEY})`).exec(what))) out.posts.push({ player, amount: num(m[1]), kind: "both" });
    else if ((m = new RegExp(String.raw`^posts the ante (${MONEY})`).exec(what))) {
      out.posts.push({ player, amount: num(m[1]), kind: "ante" });
      out.ante = Math.max(out.ante, num(m[1]));
    } else if (street >= 0 && street <= 3) {
      const allIn = /and is all-in/.test(what);
      if (/^folds/.test(what)) out.actions.push({ street, player, kind: "fold", amount: 0, to: 0, allIn: false });
      else if (/^checks/.test(what)) out.actions.push({ street, player, kind: "check", amount: 0, to: 0, allIn: false });
      else if ((m = new RegExp(String.raw`^calls (${MONEY})`).exec(what))) out.actions.push({ street, player, kind: "call", amount: num(m[1]), to: num(m[1]), allIn });
      else if ((m = new RegExp(String.raw`^bets (${MONEY})`).exec(what))) out.actions.push({ street, player, kind: "bet", amount: num(m[1]), to: num(m[1]), allIn });
      else if ((m = new RegExp(String.raw`^raises (${MONEY}) to (${MONEY})`).exec(what))) out.actions.push({ street, player, kind: "raise", amount: num(m[1]), to: num(m[2]), allIn });
    } else if (street === 4) {
      const sh = new RegExp(String.raw`^shows \[(${CARD}) (${CARD})\]`).exec(what);
      if (sh) out.shown[player] = [sh[1], sh[2]];
    }
  }
  if (!out.posts.length) return { id, reason: "no blinds posted" };
  return out;
}

export function parseHandHistory(text: string): ParseResult {
  const blocks = splitHands(text);
  const res: ParseResult = { hands: [], skipped: [], blocks: blocks.length };
  for (const b of blocks) {
    try {
      const h = parseOne(b);
      if ("reason" in h) res.skipped.push(h);
      else res.hands.push(h);
    } catch (e) {
      res.skipped.push({ id: null, reason: `could not parse (${(e as Error).message})` });
    }
  }
  return res;
}
