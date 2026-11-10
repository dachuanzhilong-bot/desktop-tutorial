import { describe, expect, it } from "vitest";
import { betNumbers, callEv, DRAW_PRESETS, impliedNeeded, outsEquity, spr, sprBand } from "../poker/math";

describe("pot odds and defence frequencies", () => {
  it("a half-pot bet: call needs 25%, defend 2/3, a third of the time a bluff must work, a quarter of bets are bluffs", () => {
    const b = betNumbers(100, 50)!;
    expect(b.size).toBe(0.5);
    expect(b.toCall).toBe(50);
    expect(b.toWin).toBe(150);
    expect(b.needed).toBeCloseTo(0.25, 12);
    expect(b.ratio).toBeCloseTo(3, 12);
    expect(b.mdf).toBeCloseTo(2 / 3, 12);
    expect(b.alpha).toBeCloseTo(1 / 3, 12);
    expect(b.bluffShare).toBeCloseTo(0.25, 12);
  });

  it("the well-known sizes", () => {
    const pot = betNumbers(100, 100)!; // pot-sized bet: 33% to call, defend half, 2:1
    expect(pot.needed).toBeCloseTo(1 / 3, 12);
    expect(pot.mdf).toBeCloseTo(0.5, 12);
    expect(pot.ratio).toBeCloseTo(2, 12);
    const third = betNumbers(90, 30)!; // a third of the pot: 20% to call
    expect(third.needed).toBeCloseTo(0.2, 12);
    const allIn = betNumbers(100, 1e9)!; // a huge overbet needs nearly half
    expect(allIn.needed).toBeGreaterThan(0.499);
    expect(allIn.needed).toBeLessThan(0.5);
  });

  it("the equity a call needs is exactly where its value is zero", () => {
    for (const [pot, bet] of [[100, 50], [37, 120], [5.5, 3]]) {
      const need = betNumbers(pot, bet)!.needed;
      expect(callEv(pot, bet, need)!).toBeCloseTo(0, 9);
      expect(callEv(pot, bet, need + 0.05)!).toBeGreaterThan(0);
      expect(callEv(pot, bet, need - 0.05)!).toBeLessThan(0);
    }
    expect(callEv(100, 50, 0.3)).toBeCloseTo(10, 12);
    expect(callEv(100, 50, 1)).toBe(150);
    expect(callEv(100, 50, 0)).toBe(-50);
  });

  it("implied odds: what is still to be won on later streets", () => {
    expect(impliedNeeded(100, 50, 0.3)).toBe(0); // already profitable
    expect(impliedNeeded(100, 50, 0.2)).toBeCloseTo(50, 9);
    // with exactly that extra amount the call breaks even
    const x = impliedNeeded(100, 50, 0.2)!;
    expect(0.2 * (150 + x) - 0.8 * 50).toBeCloseTo(0, 9);
  });

  it("refuses nonsense", () => {
    expect(betNumbers(0, 10)).toBeNull();
    expect(betNumbers(100, 0)).toBeNull();
    expect(betNumbers(-1, 5)).toBeNull();
    expect(betNumbers(Number.NaN, 5)).toBeNull();
    expect(callEv(100, 50, 1.2)).toBeNull();
    expect(impliedNeeded(100, 50, 0)).toBeNull();
  });
});

describe("outs", () => {
  it("matches the textbook numbers", () => {
    const fd = outsEquity(9, "flop")!;
    expect(fd.next).toBeCloseTo(9 / 47, 12);
    expect(fd.river).toBeCloseTo(0.3497, 4); // 35.0%
    expect(fd.rule).toBeCloseTo(0.36, 12);
    expect(outsEquity(9, "turn")!.next).toBeCloseTo(9 / 46, 12); // 19.6%
    expect(outsEquity(8, "flop")!.river).toBeCloseTo(0.3145, 4); // an open-ended straight draw: 31.5% (31.45)
    expect(outsEquity(4, "flop")!.river).toBeCloseTo(0.1647, 4); // a gutshot: 16.5% (16.47)
    expect(outsEquity(15, "flop")!.river).toBeCloseTo(0.5412, 4); // flush draw + open-ended
  });

  it("is a probability, and 0 and every card are the ends", () => {
    expect(outsEquity(0, "flop")).toMatchObject({ next: 0, river: 0 });
    expect(outsEquity(47, "flop")).toMatchObject({ next: 1, river: 1 });
    expect(outsEquity(46, "turn")!.next).toBe(1);
    expect(outsEquity(48, "flop")).toBeNull();
    expect(outsEquity(-1, "turn")).toBeNull();
    expect(outsEquity(2.5, "turn")).toBeNull();
    for (const d of DRAW_PRESETS) {
      const e = outsEquity(d.outs, "flop")!;
      expect(e.river).toBeGreaterThan(e.next);
      expect(Math.abs(e.river - e.rule)).toBeLessThan(0.07); // the rule of 4 runs a little high, 6 points at 15 outs (60% against 54%)
    }
  });
});

describe("stack-to-pot ratio", () => {
  it("is stack over pot, read in three bands", () => {
    expect(spr(100, 20)).toBe(5);
    expect(spr(0, 20)).toBe(0);
    expect(spr(100, 0)).toBeNull();
    expect(spr(-5, 10)).toBeNull();
    expect([sprBand(0.5), sprBand(3), sprBand(3.1), sprBand(10), sprBand(10.1)]).toEqual(["low", "low", "mid", "mid", "high"]);
  });
});
