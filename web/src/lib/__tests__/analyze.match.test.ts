import { describe, expect, it } from "vitest";
import { analyzeHand } from "../analyze/match";
import { normalizeHand, NormHand } from "../analyze/normalize";
import { parseHandHistory } from "../analyze/parse";
import { classByName } from "../poker/hands";
import { ActionKind } from "../solution/types";
import { parseRange, rangePercent } from "../ranges/range";
import { H_ALLIN, H_BAD_3BET, H_CO_OPEN, H_HEADS_UP, H_ODD_NAMES } from "./fixtures/hands";
import { loadManifest, loadNode } from "./helpers";

const m = loadManifest();
const src = { manifest: m, node: async (id: number) => loadNode(m, id) };
const norm = (t: string): NormHand => {
  const r = parseHandHistory(t).hands[0];
  const n = normalizeHand(r);
  if ("reason" in n) throw new Error(n.reason);
  return n;
};

describe("analysing a hand against the preflop solution", () => {
  it("grades a clear mistake: 3-betting 72o over a UTG open", async () => {
    const a = await analyzeHand(src, norm(H_BAD_3BET));
    expect(a.status).toBe("ok");
    expect(a.decisions).toHaveLength(1);
    const d = a.decisions[0];
    expect(d.spot).toBe("vsOpen");
    expect(d.handClass).toBe(classByName("72o"));
    expect(d.chosenKind).toBe(ActionKind.Raise);
    expect(m.nodes[d.best].actions).toBeDefined();
    expect(m.nodes[d.nodeId].actions[d.best].kind).toBe(ActionKind.Fold);
    expect(d.grade).toBe("blunder");
    expect(d.evLoss).toBeGreaterThan(1);
    expect(a.evLoss).toBe(d.evLoss);
    expect(a.worst).toBe(d);
    // the real raise to 8bb is within the tolerance of the solution's 3-bet size
    expect(d.sizeNote === null || d.sizeNote.real === 8).toBe(true);
  });

  it("a standard CO open with AKo is fine and yields a heads-up flop link with real ranges", async () => {
    const a = await analyzeHand(src, norm(H_CO_OPEN));
    expect(a.status).toBe("ok");
    expect(a.decisions).toHaveLength(1);
    expect(["best", "correct"]).toContain(a.decisions[0].grade);
    expect(a.decisions[0].spot).toBe("rfi");
    const l = a.flopLink!;
    expect(l).not.toBeNull();
    expect(l.board).toHaveLength(3);
    expect(l.oopSeat).toBe(5); // BB acts first after the flop
    expect(l.ipSeat).toBe(2);
    expect(l.pot).toBeCloseTo(5.5);
    expect(l.stack).toBeCloseTo(95.5);
    // CO opens roughly a quarter of the hands, BB defends a third to a half of its range against it
    const ip = rangePercent(parseRange(l.ipText).range);
    const oop = rangePercent(parseRange(l.oopText).range);
    expect(ip).toBeGreaterThan(15);
    expect(ip).toBeLessThan(40);
    expect(oop).toBeGreaterThan(15);
    expect(oop).toBeLessThan(60);
  });

  it("a 100bb jam over a button open is matched to the 3-bet (the solution has no jam there) and flagged as an approximation", async () => {
    const a = await analyzeHand(src, norm(H_ALLIN));
    const hero = a.decisions[0];
    expect(hero.spot).toBe("vsOpen");
    expect(hero.chosenKind).toBe(ActionKind.Raise);
    expect(hero.sizeNote!.real).toBeCloseTo(100);
    expect(hero.sizeNote!.tree).toBeLessThan(20);
    expect(hero.handClass).toBe(classByName("AA"));
    expect(["best", "correct"]).toContain(hero.grade);
    expect(a.flopLink).toBeNull(); // called all-in: no postflop spot to solve (the board came out)
  });

  it("heads-up and short-handed tables follow the tree through the empty seats", async () => {
    const hu = await analyzeHand(src, norm(H_HEADS_UP));
    expect(hu.status).toBe("ok");
    expect(hu.decisions).toHaveLength(1);
    expect(hu.decisions[0].seat).toBe(4);
    expect(hu.decisions[0].spot).toBe("rfi");
    const five = await analyzeHand(src, norm(H_ODD_NAMES));
    // BB flats a button open after a limp: the line has a limp the solution does not contain -> partial
    expect(["partial", "skipped", "ok"]).toContain(five.status);
  });

  it("does not grade stacks far from 100bb", async () => {
    const n = norm(H_CO_OPEN);
    n.stacks = n.stacks.map((x) => x / 5);
    const a = await analyzeHand(src, n);
    expect(a.status).toBe("skipped");
    expect(a.reason).toMatch(/outside/);
  });
});

import { filterHands, practiceItems, summarize, weakSpots } from "../analyze/aggregate";
import type { StoredHand } from "../storage/types";

describe("aggregation", () => {
  it("summarises, finds weak spots and builds practice sets", async () => {
    const texts = [H_CO_OPEN, H_BAD_3BET, H_ALLIN, H_HEADS_UP];
    const list: StoredHand[] = [];
    for (const t of texts) {
      const hand = norm(t);
      list.push({ id: hand.id, site: "pokerstars", ts: hand.ts, importedAt: 0, hand, analysis: await analyzeHand(src, hand) });
    }
    const s = summarize(list);
    expect(s.hands).toBe(4);
    expect(s.decisions).toBe(4);
    expect(s.byGrade.blunder).toBeGreaterThanOrEqual(1);
    expect(s.totalLoss).toBeGreaterThan(1);
    expect(s.lossPer100).toBeCloseTo((100 * s.totalLoss) / 4);

    const w = weakSpots(list);
    expect(w[0].spot).toBe("vsOpen");
    expect(w[0].seat).toBe(3);
    expect(w[0].mistakes).toBeGreaterThanOrEqual(1);

    const items = practiceItems(list);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].hand).toBe(classByName("72o"));
    expect(practiceItems(list, 30, 0)).toEqual([]); // nothing wrong from UTG

    const worstFirst = filterHands(list, { seat: null, mistakesOnly: false, spot: null, sort: "loss" });
    expect(worstFirst[0].id).toBe("230000000002");
    expect(filterHands(list, { seat: null, mistakesOnly: true, spot: null, sort: "recent" }).every((h) => h.analysis.evLoss > 0)).toBe(true);
    expect(filterHands(list, { seat: 4, mistakesOnly: false, spot: null, sort: "loss" }).map((h) => h.id).sort()).toEqual(["230000000003", "230000000004"]);
  });
});
