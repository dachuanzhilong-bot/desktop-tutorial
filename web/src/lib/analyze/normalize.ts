import { classOfCards, parseCard } from "../postflop/combos";
import type { ActionKind, ParsedHand } from "./parse";

/** seat ids match the preflop solution: 0 UTG, 1 HJ, 2 CO, 3 BTN, 4 SB, 5 BB */
export const SEAT_NAMES = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;

export interface NormAction {
  street: number;
  seat: number;
  kind: ActionKind;
  /** bet / raise: total bet on this street after the action, in bb. call: the chips put in, in bb. */
  bb: number;
  allIn: boolean;
}

export interface NormHand {
  id: string;
  ts: number;
  /** big blind in the table's currency (bb sizes below are in big blinds) */
  bigBlind: number;
  heroSeat: number;
  heroName: string;
  heroCards: [number, number];
  heroClass: number;
  /** player names by seat id (null = nobody there) */
  names: (string | null)[];
  /** stack at the start of the hand in bb, by seat id (0 for empty seats) */
  stacks: number[];
  actions: NormAction[];
  board: number[];
  /** hero's net result in bb */
  heroNet: number;
  /** seats that saw the flop, and the pot / stacks when it was dealt (bb) */
  flop: { seats: number[]; pot: number; stacks: number[] } | null;
  /** shown hands by seat id */
  shown: Record<number, [number, number]>;
}

export interface Unsupported {
  id: string;
  reason: string;
}

/**
 * Convert a parsed hand into hero-centric 6-max seat ids and big-blind units.
 * Hands that cannot be mapped (no hero cards, 7+ players, missing blinds) are returned as `Unsupported`.
 */
export function normalizeHand(h: ParsedHand): NormHand | Unsupported {
  const bad = (reason: string): Unsupported => ({ id: h.id, reason });
  if (!h.hero || !h.heroCards) return bad("hero cards not found");
  const sbPost = h.posts.find((p) => p.kind === "sb");
  const bbPost = h.posts.find((p) => p.kind === "bb" || p.kind === "both");
  if (!sbPost || !bbPost) return bad("small or big blind missing");
  const active = h.players.filter((p) => !p.sittingOut);
  if (active.length < 2) return bad("fewer than two active players");
  if (active.length > 6) return bad("more than six players (only 6-max positions are supported)");

  // seat order after the big blind, clockwise, up to (excluding) the small blind: UTG ... BTN
  const bySeat = [...active].sort((a, b) => a.seat - b.seat);
  const bbIdx = bySeat.findIndex((p) => p.name === bbPost.player);
  const sbIdx = bySeat.findIndex((p) => p.name === sbPost.player);
  if (bbIdx < 0 || sbIdx < 0) return bad("blind posters are not seated");
  const after: string[] = [];
  for (let k = 1; k < bySeat.length; k++) {
    const p = bySeat[(bbIdx + k) % bySeat.length];
    if (p.name === sbPost.player) break;
    after.push(p.name);
  }
  if (after.length + 2 !== active.length) return bad("could not order the seats");

  const seatOf = new Map<string, number>();
  seatOf.set(sbPost.player, 4);
  seatOf.set(bbPost.player, 5);
  after.forEach((n, i) => seatOf.set(n, 3 - (after.length - 1 - i)));
  const heroSeat = seatOf.get(h.hero);
  if (heroSeat === undefined) return bad("hero is not an active player");

  const names: (string | null)[] = [null, null, null, null, null, null];
  const stacks = [0, 0, 0, 0, 0, 0];
  for (const p of active) {
    const s = seatOf.get(p.name)!;
    names[s] = p.name;
    stacks[s] = p.stack / h.bb;
  }

  // chips committed per street per seat (for pot and net result)
  const committed = [0, 0, 0, 0, 0, 0];
  const street = [0, 0, 0, 0, 0, 0];
  for (const p of h.posts) {
    const s = seatOf.get(p.player);
    if (s === undefined) continue;
    committed[s] += p.amount;
    // antes are dead money: in the pot but not part of the preflop bet to call
    if (p.kind !== "ante") street[s] += p.amount;
  }
  const folded = new Array(6).fill(false);
  const actions: NormAction[] = [];
  let curStreet = 0;
  let flop: NormHand["flop"] = null;
  const endStreet = (upTo: number) => {
    // pot when the next street starts (uncalled bets are returned at the end of the hand, handled below)
    if (upTo === 1 && !flop) {
      const seats = [0, 1, 2, 3, 4, 5].filter((s) => names[s] && !folded[s]);
      const potChips = committed.reduce((x, y) => x + y, 0);
      flop = { seats, pot: potChips / h.bb, stacks: stacks.map((st, s) => (names[s] ? st - committed[s] / h.bb : 0)) };
    }
  };
  for (const a of h.actions) {
    if (a.street !== curStreet) {
      endStreet(a.street);
      for (let s = 0; s < 6; s++) street[s] = 0;
      curStreet = a.street;
    }
    const s = seatOf.get(a.player);
    if (s === undefined) continue;
    if (a.kind === "fold") folded[s] = true;
    let bb = 0;
    if (a.kind === "call") {
      street[s] += a.amount;
      committed[s] += a.amount;
      bb = a.amount / h.bb;
    } else if (a.kind === "bet") {
      committed[s] += a.amount - street[s];
      street[s] = a.amount;
      bb = a.amount / h.bb;
    } else if (a.kind === "raise") {
      committed[s] += a.to - street[s];
      street[s] = a.to;
      bb = a.to / h.bb;
    }
    actions.push({ street: a.street, seat: s, kind: a.kind, bb, allIn: a.allIn });
  }
  if (!flop && h.board.length >= 3) endStreet(1);
  // the pot at the flop must not include a preflop uncalled bet that is returned
  const flopSeen = h.board.length >= 3;
  const finalFlop = flopSeen ? flop : null;

  const refund = h.uncalled.reduce((m, u) => (seatOf.has(u.player) ? { ...m, [u.player]: (m[u.player] ?? 0) + u.amount } : m), {} as Record<string, number>);
  const heroCommitted = committed[heroSeat] - (refund[h.hero] ?? 0);
  const heroNet = ((h.collected[h.hero] ?? 0) - heroCommitted) / h.bb;

  const shown: Record<number, [number, number]> = {};
  for (const [n, cards] of Object.entries(h.shown)) {
    const s = seatOf.get(n);
    if (s !== undefined) shown[s] = [parseCard(cards[0]), parseCard(cards[1])];
  }
  const c1 = parseCard(h.heroCards[0]);
  const c2 = parseCard(h.heroCards[1]);
  return {
    id: h.id,
    ts: h.ts,
    bigBlind: h.bb,
    heroSeat,
    heroName: h.hero,
    heroCards: [c1, c2],
    heroClass: classOfCards(c1, c2),
    names,
    stacks,
    actions,
    board: h.board.map(parseCard),
    heroNet,
    flop: finalFlop,
    shown,
  };
}
