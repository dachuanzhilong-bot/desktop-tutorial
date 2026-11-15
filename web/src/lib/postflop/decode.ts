import { COMBOS, NC } from "./combos";

/** edge codes: >= 0 child node id; -1 fold (hand over); -2 not stored (rare line); -3 showdown; -4 all-in run-out */
export const END_FOLD = -1;
export const END_PRUNED = -2;
export const END_SHOWDOWN = -3;
export const END_ALLIN = -4;

export interface PfEdge {
  /** decision: 0 fold, 1 check/call, 2 bet/raise, 3 all-in.  chance: the card */
  kind: number;
  /** decision: the actor's total chips on this street after the action */
  amount: number;
  code: number;
}

export interface PfData {
  n: number;
  hands: Uint16Array;
  weight: Float32Array;
  eq: Float32Array;
  /** na * n */
  freq: Float32Array;
  best: Float32Array;
  /** na * n, loss against the best action (bb) */
  loss: Float32Array;
}

/** a reach range of a v3 river start, as stored: value of `hands[j]` = `q[j] / RANGE_Q * scale` (other combos 0) */
export interface PfRange {
  scale: number;
  hands: Uint16Array;
  q: Uint16Array;
}

/** quantization step of the v3 ranges (docs/03-solution-format.md, `TSP1` v3) */
export const RANGE_Q = 65535;

export interface PfNode {
  id: number;
  /** 0 flop, 1 turn, 2 river */
  street: number;
  inv: [number, number];
  /** a v3 river start is a "chance" node without edges (the river cards are not stored) and with `riverStart` */
  type: "decision" | "chance";
  /** 0 = out of position, 1 = in position */
  actor: number;
  reach: number;
  edges: PfEdge[];
  data: PfData | null;
  /** v3 only: the river start (the river is solved on the device): both players' reach ranges [OOP, IP] */
  riverStart?: [PfRange, PfRange];
  parent: number;
  parentEdge: number;
}

export interface PfFlop {
  /** `TSP1` version: 2 (river nodes stored) or 3 (river starts with reach ranges instead) */
  version?: 2 | 3;
  board: number[];
  pot: number;
  stack: number;
  nodes: PfNode[];
  /** build ID of the shipped file this came from (lib/postflop/loader.ts); absent for a flop solved on the device */
  build?: string;
}

export function decodeLoss(c: number): number {
  return c < 200 ? c / 64 : 3.125 + (c - 200);
}

export function decodeFlop(bytes: Uint8Array): PfFlop {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[4];
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "TSP1" || (version !== 2 && version !== 3)) throw new Error("bad postflop file");
  let o = 5;
  const nb = bytes[o++];
  const board: number[] = [];
  for (let i = 0; i < nb; i++) board.push(bytes[o++]);
  const pot = dv.getFloat32(o, true);
  o += 4;
  const stack = dv.getFloat32(o, true);
  o += 4;
  const count = dv.getUint16(o, true);
  o += 2;
  const nodes: PfNode[] = [];
  const bitmapLen = Math.ceil(NC / 8);
  for (let id = 0; id < count; id++) {
    const street = bytes[o++];
    const inv: [number, number] = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true)];
    o += 8;
    const kind = bytes[o++];
    const actor = bytes[o++];
    const reach = dv.getFloat32(o, true);
    o += 4;
    const ne = bytes[o++];
    const edges: PfEdge[] = [];
    for (let e = 0; e < ne; e++) {
      edges.push({ kind: bytes[o], amount: dv.getFloat32(o + 1, true), code: dv.getInt32(o + 5, true) });
      o += 9;
    }
    let data: PfData | null = null;
    let riverStart: [PfRange, PfRange] | undefined;
    if (kind === 2) {
      // v3 river start: per player f32 scale, a 1326-bit bitmap, u16 per combo of the bitmap
      if (version !== 3 || street !== 1 || ne !== 0) throw new Error("bad postflop file");
      const one = (): PfRange => {
        const scale = dv.getFloat32(o, true);
        o += 4;
        const hands: number[] = [];
        for (let h = 0; h < NC; h++) if (bytes[o + (h >> 3)] & (1 << (h & 7))) hands.push(h);
        o += bitmapLen;
        const q = new Uint16Array(hands.length);
        for (let j = 0; j < hands.length; j++) q[j] = dv.getUint16(o + j * 2, true);
        o += hands.length * 2;
        return { scale, hands: Uint16Array.from(hands), q };
      };
      const oop = one();
      riverStart = [oop, one()];
    } else if (kind > 2) throw new Error("bad postflop file");
    if (kind === 0) {
      const na = ne;
      const hands: number[] = [];
      for (let h = 0; h < NC; h++) if (bytes[o + (h >> 3)] & (1 << (h & 7))) hands.push(h);
      o += bitmapLen;
      const n = hands.length;
      const weight = new Float32Array(n);
      const eq = new Float32Array(n);
      for (let j = 0; j < n; j++) weight[j] = bytes[o + j] / 255;
      o += n;
      for (let j = 0; j < n; j++) eq[j] = bytes[o + j] / 255;
      o += n;
      const freq = new Float32Array(na * n);
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let a = 0; a < na; a++) s += bytes[o + a * n + j];
        for (let a = 0; a < na; a++) freq[a * n + j] = s > 0 ? bytes[o + a * n + j] / s : 1 / na;
      }
      o += na * n;
      const best = new Float32Array(n);
      for (let j = 0; j < n; j++) best[j] = dv.getInt16(o + j * 2, true) / 64;
      o += n * 2;
      const loss = new Float32Array(na * n);
      for (let i = 0; i < na * n; i++) loss[i] = decodeLoss(bytes[o + i]);
      o += na * n;
      data = { n, hands: Uint16Array.from(hands), weight, eq, freq, best, loss };
    }
    const node: PfNode = { id, street, inv, type: kind === 0 ? "decision" : "chance", actor, reach, edges, data, parent: -1, parentEdge: -1 };
    if (riverStart) node.riverStart = riverStart;
    nodes.push(node);
  }
  if (o !== bytes.length) throw new Error("bad postflop file");
  for (const n of nodes) n.edges.forEach((e, i) => {
    if (e.code >= 0 && nodes[e.code]) {
      nodes[e.code].parent = n.id;
      nodes[e.code].parentEdge = i;
    }
  });
  return { version: version === 3 ? 3 : 2, board, pot, stack, nodes };
}

/** the board at a node: the flop + the cards dealt on the way from the root */
export function boardAt(flop: PfFlop, nodeId: number): number[] {
  const cards: number[] = [];
  for (let n = flop.nodes[nodeId]; n && n.parent >= 0; n = flop.nodes[n.parent]) {
    const p = flop.nodes[n.parent];
    if (p.type === "chance") cards.unshift(p.edges[n.parentEdge].kind);
  }
  return [...flop.board, ...cards];
}

/** a v3 range, 1326 wide; in f32 arithmetic as the solver reads it (`QRange::dense`), so the device solves the same numbers */
export function denseRange(r: PfRange): Float32Array {
  const out = new Float32Array(NC);
  for (let j = 0; j < r.hands.length; j++) out[r.hands[j]] = Math.fround(Math.fround(r.q[j] / RANGE_Q) * r.scale);
  return out;
}

/**
 * The reach ranges [OOP, IP] (1326 wide) with which the river is solved after `riverCard` is dealt at the v3 river start
 * `nodeId`: the stored ranges with the combos holding `riverCard` set to 0.  `null` if the node is not a river start or
 * the card is not a live card there (on the board, or not 0..51).
 */
export function riverStartRanges(flop: PfFlop, nodeId: number, riverCard: number): [Float32Array, Float32Array] | null {
  const node = flop.nodes[nodeId];
  if (!node?.riverStart || !Number.isInteger(riverCard) || riverCard < 0 || riverCard > 51 || boardAt(flop, nodeId).includes(riverCard)) return null;
  const out = node.riverStart.map(denseRange) as [Float32Array, Float32Array];
  for (let h = 0; h < NC; h++) {
    if (COMBOS[h].c1 === riverCard || COMBOS[h].c2 === riverCard) {
      out[0][h] = 0;
      out[1][h] = 0;
    }
  }
  return out;
}

/** dense (1326 wide) view of a decision node */
export interface DenseNode {
  na: number;
  weight: Float32Array;
  eq: Float32Array;
  freq: Float32Array;
  ev: Float32Array;
  /** which combos are in the range */
  present: Uint8Array;
}

export function dense(node: PfNode): DenseNode | null {
  const d = node.data;
  if (!d) return null;
  const na = node.edges.length;
  const out: DenseNode = { na, weight: new Float32Array(NC), eq: new Float32Array(NC), freq: new Float32Array(na * NC), ev: new Float32Array(na * NC), present: new Uint8Array(NC) };
  for (let j = 0; j < d.n; j++) {
    const h = d.hands[j];
    out.present[h] = 1;
    out.weight[h] = d.weight[j];
    out.eq[h] = d.eq[j];
    for (let a = 0; a < na; a++) {
      out.freq[a * NC + h] = d.freq[a * d.n + j];
      out.ev[a * NC + h] = d.best[j] - d.loss[a * d.n + j];
    }
  }
  return out;
}
