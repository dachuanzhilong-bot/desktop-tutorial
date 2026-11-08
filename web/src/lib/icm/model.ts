/** positions in acting order, by table size (index 0 acts first; the last two are the blinds) */
export const POSITIONS: Record<number, string[]> = {
  2: ["SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["CO", "BTN", "SB", "BB"],
  5: ["HJ", "CO", "BTN", "SB", "BB"],
  6: ["UTG", "HJ", "CO", "BTN", "SB", "BB"],
  7: ["UTG", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  8: ["UTG", "UTG+1", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
  9: ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB", "BB"],
};

export interface PayoutPreset {
  id: string;
  /** prizes of 1st, 2nd, ... (any unit) */
  payouts: number[];
}

export const PAYOUT_PRESETS: PayoutPreset[] = [
  { id: "wta", payouts: [1] },
  { id: "hu", payouts: [65, 35] },
  { id: "top3", payouts: [50, 30, 20] },
  { id: "top4", payouts: [40, 30, 20, 10] },
  { id: "ft9", payouts: [30, 20, 14, 10, 8, 7, 5, 4, 2] },
  { id: "sat", payouts: [1, 1, 1] },
];

export interface IcmInput {
  /** stacks in big blinds, acting order */
  stacks: number[];
  sb: number;
  bb: number;
  ante: number;
  payouts: number[];
}

export const toConfig = (i: IcmInput): number[] => [i.stacks.length, i.sb, i.bb, i.ante, i.payouts.length, ...i.stacks, ...i.payouts];

export function parsePayouts(text: string): number[] | null {
  const v = text
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return v.length && v.every((x) => Number.isFinite(x) && x >= 0) && v.some((x) => x > 0) ? v : null;
}

export interface IcmNode {
  player: number;
  /** null = opening decision (jam / fold); otherwise the player whose jam is faced (call / fold) */
  facing: number | null;
  reach: number;
  weight: Float32Array;
  freq: Float32Array;
  /** value of jamming (calling) / folding, % of the prize pool */
  evAct: Float32Array;
  evFold: Float32Array;
}

export interface IcmSolution {
  players: number;
  /** ICM equity of the stacks now, % of the prize pool */
  startEquity: number[];
  nodes: IcmNode[];
}

const K = 169;

export function decodeIcm(d: Float32Array): IcmSolution {
  const players = d[0];
  const count = d[1];
  const startEquity = Array.from(d.subarray(2, 2 + players));
  let o = 2 + players;
  const nodes: IcmNode[] = [];
  for (let i = 0; i < count; i++) {
    const player = d[o];
    const f = d[o + 1];
    const reach = d[o + 2];
    o += 3;
    const take = () => {
      const v = d.slice(o, o + K);
      o += K;
      return v;
    };
    nodes.push({ player, facing: f < 0 ? null : f, reach, weight: take(), freq: take(), evAct: take(), evFold: take() });
  }
  return { players, startEquity, nodes };
}

/** share of the player's combos that jam (call) at a node, in % */
export function rangePercent(n: IcmNode, combos: (h: number) => number): number {
  let num = 0;
  let den = 0;
  for (let h = 0; h < K; h++) {
    const c = combos(h);
    num += c * n.weight[h] * n.freq[h];
    den += c * n.weight[h];
  }
  return den > 0 ? (100 * num) / den : 0;
}
