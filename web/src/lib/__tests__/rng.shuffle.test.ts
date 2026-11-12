import { describe, expect, it } from "vitest";
import { mulberry32, shuffle } from "../util/rng";

/** rnd that replays a fixed list of values */
const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++];
};

describe("shuffle (Fisher–Yates)", () => {
  it("keeps every element exactly once", () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffle(input, mulberry32(7));
    expect(out).toHaveLength(input.length);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it("returns a new array and leaves the input untouched", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    const out = shuffle(input, mulberry32(1));
    expect(out).not.toBe(input);
    expect(input).toEqual(copy);
  });

  it("gives a fixed order for a fixed random sequence", () => {
    // i=3: j=floor(0.0*4)=0 → [d,b,c,a]; i=2: j=floor(0.5*3)=1 → [d,c,b,a]; i=1: j=floor(0.99*2)=1 → no change
    expect(shuffle(["a", "b", "c", "d"], seq([0, 0.5, 0.99]))).toEqual(["d", "c", "b", "a"]);
    // rnd always just below 1 → every element stays where it is
    expect(shuffle(["a", "b", "c", "d"], () => 0.999)).toEqual(["a", "b", "c", "d"]);
    // same seed → same order
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffle(input, mulberry32(42))).toEqual(shuffle(input, mulberry32(42)));
  });

  it("draws exactly n-1 random numbers", () => {
    let calls = 0;
    shuffle([1, 2, 3, 4, 5, 6], () => {
      calls++;
      return 0.3;
    });
    expect(calls).toBe(5);
  });

  it("handles empty and single-element input", () => {
    expect(shuffle([], mulberry32(1))).toEqual([]);
    expect(shuffle(["x"], mulberry32(1))).toEqual(["x"]);
  });

  it("is unbiased: each of the 6 orders of 3 items appears about equally often", () => {
    const rnd = mulberry32(12345);
    const counts = new Map<string, number>();
    const n = 60000;
    for (let i = 0; i < n; i++) {
      const k = shuffle([0, 1, 2], rnd).join("");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // expected 10000 each, sd ≈ 91; ±5% is > 5 sd
    for (const c of counts.values()) {
      expect(c).toBeGreaterThan(9500);
      expect(c).toBeLessThan(10500);
    }
  });
});
