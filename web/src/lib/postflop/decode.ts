import { NC } from "./combos";

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

export interface PfNode {
  id: number;
  /** 0 flop, 1 turn, 2 river */
  street: number;
  inv: [number, number];
  type: "decision" | "chance";
  /** 0 = out of position, 1 = in position */
  actor: number;
  reach: number;
  edges: PfEdge[];
  data: PfData | null;
  parent: number;
  parentEdge: number;
}

export interface PfFlop {
  board: number[];
  pot: number;
  stack: number;
  nodes: PfNode[];
}

export function decodeLoss(c: number): number {
  return c < 200 ? c / 64 : 3.125 + (c - 200);
}

export function decodeFlop(bytes: Uint8Array): PfFlop {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "TSP1" || bytes[4] !== 2) throw new Error("bad postflop file");
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
    nodes.push({ id, street, inv, type: kind === 0 ? "decision" : "chance", actor, reach, edges, data, parent: -1, parentEdge: -1 });
  }
  for (const n of nodes) n.edges.forEach((e, i) => {
    if (e.code >= 0 && nodes[e.code]) {
      nodes[e.code].parent = n.id;
      nodes[e.code].parentEdge = i;
    }
  });
  return { board, pot, stack, nodes };
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
