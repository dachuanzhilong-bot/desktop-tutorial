import { describe, expect, it } from "vitest";
import { parseHandHistory } from "../analyze/parse";
import { normalizeHand, NormHand } from "../analyze/normalize";
import { classByName } from "../poker/hands";
import { FILE_CRLF_BOM, H_ALLIN, H_GG, H_BAD_3BET, H_CO_OPEN, H_HEADS_UP, H_ODD_NAMES, H_OMAHA, H_TOURNAMENT } from "./fixtures/hands";

const one = (t: string) => {
  const r = parseHandHistory(t);
  expect(r.skipped).toEqual([]);
  expect(r.hands).toHaveLength(1);
  return r.hands[0];
};
const norm = (t: string): NormHand => {
  const n = normalizeHand(one(t));
  if ("reason" in n) throw new Error(n.reason);
  return n;
};

describe("PokerStars parser", () => {
  it("reads header, seats, blinds, board and actions", () => {
    const h = one(H_CO_OPEN);
    expect(h.id).toBe("230000000001");
    expect(h.sb).toBe(0.5);
    expect(h.bb).toBe(1);
    expect(h.currency).toBe("USD");
    expect(h.tableSize).toBe(6);
    expect(h.buttonSeat).toBe(4);
    expect(h.players).toHaveLength(6);
    expect(h.hero).toBe("Hero");
    expect(h.heroCards).toEqual(["Ah", "Kd"]);
    expect(h.board).toEqual(["Ks", "7d", "2c", "9h", "3s"]);
    expect(h.posts.map((p) => p.kind)).toEqual(["sb", "bb"]);
    expect(h.actions.filter((a) => a.street === 0).map((a) => `${a.player}:${a.kind}`)).toEqual(["Alice:fold", "Bob:fold", "Hero:raise", "Dan:fold", "Eve:fold", "Frank:call"]);
    const raise = h.actions.find((a) => a.kind === "raise")!;
    expect(raise.amount).toBe(1.5);
    expect(raise.to).toBe(2.5);
    expect(h.uncalled).toEqual([{ player: "Hero", amount: 6 }]);
    expect(h.collected.Hero).toBeCloseTo(10.45);
    expect(h.ts).toBe(Date.UTC(2024, 2, 2, 20, 15, 1));
  });

  it("handles all-in markers, showdown and the turn/river cards", () => {
    const h = one(H_ALLIN);
    expect(h.actions.find((a) => a.player === "Hero" && a.kind === "raise")!.allIn).toBe(true);
    expect(h.shown.Hero).toEqual(["As", "Ad"]);
    expect(h.shown.Bob).toEqual(["Kh", "Kd"]);
    expect(h.board).toEqual(["2c", "7d", "Ts", "Jc", "3h"]);
  });

  it("skips tournaments and other games with a reason, and keeps the good hands (CRLF + BOM, many hands)", () => {
    const r = parseHandHistory(FILE_CRLF_BOM);
    expect(r.hands.map((h) => h.id)).toEqual(["230000000001", "230000000002"]);
    expect(r.skipped).toEqual([{ id: "230000000005", reason: "tournament hands are not supported" }]);
    expect(parseHandHistory(H_OMAHA).skipped[0].reason).toMatch(/No-Limit/);
    expect(parseHandHistory("hello")).toEqual({ hands: [], skipped: [], blocks: 0 });
    expect(r.blocks).toBe(3);
  });

  it("resolves player names that contain colons and spaces", () => {
    const h = one(H_ODD_NAMES);
    expect(h.actions.find((a) => a.player === "Mr: X")).toBeDefined();
    expect(h.posts[0].player).toBe("Mr: X");
    expect(h.actions.filter((a) => a.player === "p l a y e r")).toHaveLength(1);
    expect(h.players.find((p) => p.name === "Sitter")!.sittingOut).toBe(true);
    expect(h.players.find((p) => p.name === "Hal")!.stack).toBe(50);
  });
});

describe("GGPoker layout (experimental)", () => {
  it("reads a Poker Hand # header and mixes with PokerStars hands", () => {
    const r = parseHandHistory([H_GG, H_CO_OPEN].join("\n\n"));
    expect(r.skipped).toEqual([]);
    expect(r.hands.map((h) => [h.site, h.id])).toEqual([["ggpoker", "HD2300000009"], ["pokerstars", "230000000001"]]);
    const n = normalizeHand(r.hands[0]);
    if ("reason" in n) throw new Error(n.reason);
    expect(n.heroSeat).toBe(2);
    expect(n.heroClass).toBe(classByName("AKo"));
    expect(n.heroNet).toBeCloseTo(1.25, 2); // 2.25 collected - (2.5 put in - 1.5 returned)
  });
});

describe("normalisation to 6-max seats and bb units", () => {
  it("assigns positions from the blinds and converts chips to bb", () => {
    const n = norm(H_CO_OPEN);
    expect(n.heroSeat).toBe(2); // CO: Alice UTG, Bob HJ, Hero CO, Dan BTN
    expect(n.names).toEqual(["Alice", "Bob", "Hero", "Dan", "Eve", "Frank"]);
    expect(n.heroClass).toBe(classByName("AKo"));
    expect(n.stacks[2]).toBeCloseTo(98);
    const open = n.actions.find((a) => a.kind === "raise")!;
    expect(open.seat).toBe(2);
    expect(open.bb).toBeCloseTo(2.5);
    // pot when the flop is dealt: 2.5 (hero) + 2.5 (BB) + 0.5 (SB, dead) = 5.5
    expect(n.flop!.pot).toBeCloseTo(5.5);
    expect(n.flop!.seats).toEqual([2, 5]);
    expect(n.flop!.stacks[2]).toBeCloseTo(98 - 2.5);
    // net: committed 2.5 + 3 (+6 refunded) = 5.5, collected 10.45
    expect(n.heroNet).toBeCloseTo(10.45 - 5.5);
    expect(n.board).toHaveLength(5);
  });

  it("5-handed tables drop the early seats, a sitting-out player is ignored", () => {
    const n = norm(H_ODD_NAMES);
    // blinds: Mr: X (SB) and Hero (BB); after the BB: p l a y e r, Gina, Hal (button)
    expect(n.names).toEqual([null, "p l a y e r", "Gina", "Hal", "Mr: X", "Hero"].map((x, i) => (i === 0 ? null : x)));
    expect(n.heroSeat).toBe(5);
    expect(n.names.filter(Boolean)).toHaveLength(5);
  });

  it("heads-up: the button is the small blind", () => {
    const n = norm(H_HEADS_UP);
    expect(n.heroSeat).toBe(4);
    expect(n.names[5]).toBe("Villain");
    expect(n.bigBlind).toBe(2);
    expect(n.actions[0].bb).toBeCloseTo(3);
    expect(n.heroNet).toBeCloseTo(2 / 2); // wins the big blind (1bb)
    expect(n.flop).toBeNull();
  });

  it("net result of a hand lost with an uncalled bet returned", () => {
    const n = norm(H_BAD_3BET);
    expect(n.heroSeat).toBe(3); // button
    expect(n.heroNet).toBeCloseTo(-8);
  });

  it("flags hands it cannot place", () => {
    const h = one(H_ALLIN);
    h.heroCards = null;
    expect(normalizeHand(h)).toMatchObject({ reason: "hero cards not found" });
    const g = one(H_CO_OPEN);
    g.posts = [];
    expect(normalizeHand(g)).toMatchObject({ reason: "small or big blind missing" });
  });
});
