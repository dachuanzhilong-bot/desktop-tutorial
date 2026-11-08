import { describe, expect, it } from "vitest";
import { actionForRoll, gradeAnswer, isGood } from "../practice/grading";
import { BOX_INTERVAL_MIN, mixedness, priorityWeight, updateSrs } from "../practice/srs";
import type { SrsItem } from "../practice/srs";
import { mulberry32, weightedPick } from "../util/rng";

const stats = (rows: [number, number][]) => rows.map(([freq, ev]) => ({ freq, ev }));

describe("grading by EV loss", () => {
  it("best action", () => {
    const g = gradeAnswer(stats([[0, 0], [0.2, 0.5], [0.8, 1.2]]), 2);
    expect(g.grade).toBe("best");
    expect(g.evLoss).toBe(0);
    expect(g.score).toBe(100);
  });
  it("mixed strategy actions count as correct even with a small EV gap", () => {
    const g = gradeAnswer(stats([[0, 0], [0.4, 1.1], [0.6, 1.2]]), 1);
    expect(g.grade).toBe("correct");
    expect(g.evLoss).toBeCloseTo(0.1, 5);
    expect(g.score).toBeGreaterThanOrEqual(90);
  });
  it("thresholds", () => {
    const base = (loss: number) => gradeAnswer(stats([[1, loss], [0, 0]]), 1).grade;
    expect(base(0.003)).toBe("best");
    expect(base(0.04)).toBe("correct");
    expect(base(0.15)).toBe("inaccurate");
    expect(base(0.5)).toBe("mistake");
    expect(base(0.9)).toBe("blunder");
  });
  it("score is monotone in EV loss and bounded", () => {
    let prev = 101;
    for (const loss of [0, 0.05, 0.1, 0.2, 0.4, 0.8, 3]) {
      const s = gradeAnswer(stats([[1, loss], [0, 0]]), 1).score;
      expect(s).toBeLessThanOrEqual(prev);
      expect(s).toBeGreaterThanOrEqual(0);
      prev = s;
    }
    expect(prev).toBe(0);
  });
  it("isGood", () => {
    expect(isGood("best") && isGood("correct")).toBe(true);
    expect(isGood("mistake")).toBe(false);
  });
});

describe("RNG mode", () => {
  it("maps a roll to the action following the frequencies", () => {
    const freqs = [0.1, 0.3, 0.6]; // fold, call, raise
    const order = [2, 1, 0]; // raise first
    expect(actionForRoll(freqs, order, 0.0)).toBe(2);
    expect(actionForRoll(freqs, order, 0.59)).toBe(2);
    expect(actionForRoll(freqs, order, 0.61)).toBe(1);
    expect(actionForRoll(freqs, order, 0.95)).toBe(0);
  });
  it("is statistically faithful", () => {
    const rnd = mulberry32(5);
    const counts = [0, 0, 0];
    for (let i = 0; i < 20000; i++) counts[actionForRoll([0.1, 0.3, 0.6], [2, 1, 0], rnd())]++;
    expect(counts[2] / 20000).toBeCloseTo(0.6, 1);
    expect(counts[1] / 20000).toBeCloseTo(0.3, 1);
  });
});

describe("spaced repetition", () => {
  const t0 = 1_700_000_000_000;
  it("promotes on good answers and resets on misses", () => {
    let it = updateSrs(undefined, 3, 10, "best", t0);
    expect(it.box).toBe(1);
    expect(it.due).toBe(t0 + BOX_INTERVAL_MIN[1] * 60_000);
    it = updateSrs(it, 3, 10, "correct", t0 + 1);
    expect(it.box).toBe(2);
    it = updateSrs(it, 3, 10, "mistake", t0 + 2);
    expect(it.box).toBe(0);
    expect(it.lapses).toBe(1);
    expect(it.due).toBe(t0 + 2);
  });
  it("prioritises mistakes and mixed hands, deprioritises mastered ones", () => {
    const miss = updateSrs(undefined, 1, 1, "blunder", t0);
    const mastered = { ...updateSrs(updateSrs(undefined, 1, 2, "best", t0), 1, 2, "best", t0), due: t0 + 1e9 };
    const w = (item: SrsItem | undefined, mixed = 0) => priorityWeight({ item, now: t0 + 10, mixedness: mixed, mixedBoost: true });
    expect(w(miss)).toBeGreaterThan(w(undefined));
    expect(w(undefined, 1)).toBeGreaterThan(w(undefined, 0));
    expect(w(mastered)).toBeLessThan(w(undefined));
  });
  it("mixedness", () => {
    expect(mixedness([1, 0, 0])).toBe(0);
    expect(mixedness([0.5, 0.5])).toBe(1);
    expect(mixedness([0.8, 0.2])).toBeCloseTo(0.4, 5);
  });
  it("weightedPick respects weights", () => {
    const rnd = mulberry32(1);
    const c = [0, 0, 0];
    for (let i = 0; i < 6000; i++) c[weightedPick([1, 0, 5], rnd)]++;
    expect(c[1]).toBe(0);
    expect(c[2] / 6000).toBeGreaterThan(0.78);
  });
});
