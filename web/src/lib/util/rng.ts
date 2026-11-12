/** mulberry32 – deterministic PRNG for tests and reproducible sessions */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const cryptoRandom = (): number => {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 4294967296;
  }
  return Math.random();
};

export function weightedPick(weights: ArrayLike<number>, rnd: () => number): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (total <= 0) return Math.floor(rnd() * weights.length);
  let r = rnd() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Fisher–Yates shuffle. Returns a new array; the input is left untouched.
 * Every permutation is equally likely when `rnd` is uniform on [0, 1).
 * (`sort(() => rnd() - 0.5)` is not: the comparator is inconsistent, so the
 * result depends on the engine's sort algorithm and favours some orders.)
 */
export function shuffle<T>(items: readonly T[], rnd: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
