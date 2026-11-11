import { COMBOS } from "../postflop/combos";
import { eval7 } from "./eval7";

/**
 * Equity of 2 to 4 players, each holding one known hand or a weighted range, on a board of 0, 3, 4 or 5 cards.
 *
 *  - every player holds exactly one hand: all runouts are counted, so the answer is exact
 *    (for two hands before the flop that is 1,712,304 boards, a fraction of a second)
 *  - otherwise: random deals (a hand drawn from each range by weight, then the rest of the board), with the
 *    standard error of each equity, so the screen can say how far to trust the number
 *
 * Equity = share of the pot: an outright win counts 1, a tie counts 1 / (players who tie).
 * Cards are codes 0..51 as in lib/postflop/combos.ts.
 */
export interface EquityPlayer {
  c1: number[];
  c2: number[];
  w: number[];
}

export const playerFromHand = (a: number, b: number): EquityPlayer => ({ c1: [a], c2: [b], w: [1] });

/** a range given as 169 weights (the 13x13 chart) or 1,326 combo weights */
export function playerFromRange(weights: ArrayLike<number>): EquityPlayer {
  const p: EquityPlayer = { c1: [], c2: [], w: [] };
  const perCombo = weights.length === COMBOS.length;
  COMBOS.forEach((c, i) => {
    const w = perCombo ? weights[i] : weights[c.cls];
    if (w > 0) {
      p.c1.push(c.c1);
      p.c2.push(c.c2);
      p.w.push(w);
    }
  });
  return p;
}

export interface PlayerResult {
  /** share of the pot, 0..1 */
  equity: number;
  /** wins outright */
  win: number;
  /** ties for the best hand (with one or more others) */
  tie: number;
  /** standard error of `equity` (0 when exact) */
  stdErr: number;
}
export interface EquityResult {
  players: PlayerResult[];
  exact: boolean;
  /** boards counted (exact) or deals drawn (sampled) */
  boards: number;
}

export type EquityProblem = "boardSize" | "duplicateCard" | "noCombos" | "impossible";
export class EquityError extends Error {
  constructor(readonly problem: EquityProblem) {
    super(problem);
  }
}

/** a board must have 0, 3, 4 or 5 distinct cards */
export function validateBoard(board: number[]): EquityProblem | null {
  if (![0, 3, 4, 5].includes(board.length)) return "boardSize";
  return new Set(board).size === board.length ? null : "duplicateCard";
}

export const EXACT_LIMIT = 2_000_000;

const binom = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

interface Prepared {
  c1: Int32Array;
  c2: Int32Array;
  /** cumulative weights, last = 1 */
  cum: Float64Array;
}

/** keeps the combos that do not use a board card; normalised cumulative weights for drawing */
function prepare(p: EquityPlayer, dead: Set<number>): Prepared {
  const c1: number[] = [];
  const c2: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < p.w.length; i++) {
    if (p.w[i] > 0 && !dead.has(p.c1[i]) && !dead.has(p.c2[i]) && p.c1[i] !== p.c2[i]) {
      c1.push(p.c1[i]);
      c2.push(p.c2[i]);
      w.push(p.w[i]);
    }
  }
  if (!w.length) throw new EquityError("noCombos");
  const total = w.reduce((a, b) => a + b, 0);
  const cum = new Float64Array(w.length);
  let acc = 0;
  w.forEach((x, i) => (cum[i] = acc += x / total));
  cum[w.length - 1] = 1;
  return { c1: Int32Array.from(c1), c2: Int32Array.from(c2), cum };
}

/** the work, in slices: step(n) deals or counts up to n boards */
export class EquityCalc {
  readonly exact: boolean;
  /** boards to count (exact) or deals to draw (sampled) */
  readonly total: number;
  private done = 0;
  private readonly n: number;
  private readonly pl: Prepared[];
  private readonly board: number[];
  private readonly hands: Int32Array[];
  private readonly eq: Float64Array;
  private readonly sq: Float64Array;
  private readonly wins: Float64Array;
  private readonly ties: Float64Array;
  private readonly score: Float64Array;
  private readonly rnd: () => number;
  // exact mode
  private deck: number[] = [];
  private idx: number[] = [];
  private more = true;
  // sampling mode
  private readonly stamp = new Int32Array(52);
  private cur = 0;

  constructor(players: EquityPlayer[], board: number[], samples: number, rnd: () => number = Math.random, exactLimit = EXACT_LIMIT) {
    const bad = validateBoard(board);
    if (bad) throw new EquityError(bad);
    this.n = players.length;
    this.board = board;
    this.rnd = rnd;
    const dead = new Set(board);
    this.pl = players.map((p) => prepare(p, dead));
    this.hands = this.pl.map(() => new Int32Array(7));
    this.eq = new Float64Array(this.n);
    this.sq = new Float64Array(this.n);
    this.wins = new Float64Array(this.n);
    this.ties = new Float64Array(this.n);
    this.score = new Float64Array(this.n);
    const need = 5 - board.length;
    const fixed = this.pl.every((p) => p.cum.length === 1);
    if (fixed) {
      const seen = new Set(board);
      for (const p of this.pl) for (const c of [p.c1[0], p.c2[0]]) {
        if (seen.has(c)) throw new EquityError("duplicateCard");
        seen.add(c);
      }
      this.deck = Array.from({ length: 52 }, (_, i) => i).filter((c) => !seen.has(c));
      const runouts = binom(this.deck.length, need);
      if (runouts <= exactLimit) {
        this.exact = true;
        this.total = runouts;
        this.idx = Array.from({ length: need }, (_, i) => i);
        board.forEach((c, i) => this.hands.forEach((h) => (h[2 + i] = c)));
        this.pl.forEach((p, i) => {
          this.hands[i][0] = p.c1[0];
          this.hands[i][1] = p.c2[0];
        });
        return;
      }
    }
    this.exact = false;
    this.total = samples;
    board.forEach((c, i) => this.hands.forEach((h) => (h[2 + i] = c)));
  }

  get finished(): boolean {
    return this.exact ? !this.more : this.done >= this.total;
  }
  get progress(): number {
    return this.exact ? this.done / Math.max(1, this.total) : Math.min(1, this.done / this.total);
  }

  /** deals or counts up to `n` more boards */
  step(n: number): void {
    const k = 5 - this.board.length;
    const b0 = this.board.length + 2;
    if (this.exact) {
      const { idx, deck } = this;
      const m = deck.length;
      for (let t = 0; t < n && this.more; t++) {
        for (let i = 0; i < k; i++) for (const h of this.hands) h[b0 + i] = deck[idx[i]];
        this.tally();
        // next combination of k from m, in order
        let i = k - 1;
        while (i >= 0 && idx[i] === m - k + i) i--;
        if (i < 0) this.more = false;
        else {
          idx[i]++;
          for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
        }
        this.done++;
      }
      return;
    }
    const stamp = this.stamp;
    const end = Math.min(this.total, this.done + n);
    for (; this.done < end; this.done++) {
      // draw one hand per player by weight; a clash of cards means draw them all again
      let tries = 0;
      for (;;) {
        this.cur++;
        for (const c of this.board) stamp[c] = this.cur;
        let ok = true;
        for (let p = 0; p < this.n && ok; p++) {
          const pr = this.pl[p];
          const r = this.rnd();
          let lo = 0;
          let hi = pr.cum.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (pr.cum[mid] < r) lo = mid + 1;
            else hi = mid;
          }
          const a = pr.c1[lo];
          const b = pr.c2[lo];
          if (stamp[a] === this.cur || stamp[b] === this.cur) ok = false;
          else {
            stamp[a] = stamp[b] = this.cur;
            this.hands[p][0] = a;
            this.hands[p][1] = b;
          }
        }
        if (ok) break;
        if (++tries > 2000) throw new EquityError("impossible");
      }
      for (let i = 0; i < k; i++) {
        // uniform over the free cards: draw again when the card is taken (stepping to the next code would favour its neighbours)
        let c = Math.floor(this.rnd() * 52);
        while (stamp[c] === this.cur) c = Math.floor(this.rnd() * 52);
        stamp[c] = this.cur;
        for (const h of this.hands) h[b0 + i] = c;
      }
      this.tally();
    }
  }

  private tally() {
    let best = -1;
    for (let p = 0; p < this.n; p++) {
      const s = eval7(this.hands[p]);
      this.score[p] = s;
      if (s > best) best = s;
    }
    let w = 0;
    for (let p = 0; p < this.n; p++) if (this.score[p] === best) w++;
    for (let p = 0; p < this.n; p++) {
      if (this.score[p] !== best) continue;
      const share = 1 / w;
      this.eq[p] += share;
      this.sq[p] += share * share;
      if (w === 1) this.wins[p]++;
      else this.ties[p]++;
    }
  }

  result(): EquityResult {
    const n = Math.max(1, this.done);
    return {
      exact: this.exact,
      boards: this.done,
      players: Array.from({ length: this.n }, (_, p) => {
        const mean = this.eq[p] / n;
        const variance = Math.max(0, this.sq[p] / n - mean * mean);
        return { equity: mean, win: this.wins[p] / n, tie: this.ties[p] / n, stdErr: this.exact ? 0 : Math.sqrt(variance / n) };
      }),
    };
  }
}

export interface ComputeOptions {
  samples?: number;
  rnd?: () => number;
  exactLimit?: number;
  /** boards per slice before `yieldNow` is awaited */
  slice?: number;
  yieldNow?: () => Promise<void>;
  onProgress?: (fraction: number, partial: EquityResult) => void;
  signal?: AbortSignal;
}

/** the whole calculation in slices that leave the page responsive; resolves to null when aborted */
export async function computeEquity(players: EquityPlayer[], board: number[], o: ComputeOptions = {}): Promise<EquityResult | null> {
  const calc = new EquityCalc(players, board, o.samples ?? 200_000, o.rnd, o.exactLimit);
  const slice = o.slice ?? 25_000;
  while (!calc.finished) {
    if (o.signal?.aborted) return null;
    calc.step(slice);
    o.onProgress?.(calc.progress, calc.result());
    if (o.yieldNow) await o.yieldNow();
  }
  return calc.result();
}
