import { NUM_CLASSES } from "../poker/hands";
import type { Manifest, NodeMeta, NodeSolution, ActionMeta } from "./types";

const K = NUM_CLASSES;

/** manifest.json as written by the solver exporter (solver/src/export.rs) */
export interface RawManifest {
  format: number;
  id: string;
  players: string[];
  stack: number;
  blinds: [number, number];
  info?: Record<string, unknown>;
  chunks: string[];
  /** [actor, reach, chunk, actions[[kind, to, child, term]]] */
  nodes: [number, number, number, number[][]][];
}

/** Parse the raw manifest JSON written by the solver exporter into rich node metadata. */
export function parseManifest(raw: RawManifest): Manifest {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.chunks)) throw new Error("invalid solution manifest");
  const nodes: NodeMeta[] = raw.nodes.map((n, id) => ({
    id,
    actor: n[0],
    reach: n[1],
    chunk: n[2],
    actions: n[3].map(
      (a): ActionMeta => ({ kind: a[0], to: a[1], child: a[2], term: a[3] }),
    ),
    parent: -1,
    parentAction: -1,
  }));
  for (const n of nodes) {
    n.actions.forEach((a, i) => {
      if (a.child >= 0) {
        nodes[a.child].parent = n.id;
        nodes[a.child].parentAction = i;
      }
    });
  }
  return {
    format: raw.format,
    id: raw.id,
    players: raw.players,
    stack: raw.stack,
    blinds: raw.blinds,
    info: raw.info ?? {},
    chunks: raw.chunks,
    nodes,
  };
}

/**
 * Decode one (already decompressed) chunk. Binary layout, little endian:
 *   "TSR1" | u32 nodeCount | records
 *   record: u32 nodeId | u8 nActions | u8 flags(bit0 = has EQR)
 *           u8 weight[169] | u8 equity[169] | u8 freq[nA][169] | i16 ev[nA][169] (1/256 bb)
 *           | u8 eqr[169] (x100)   (only if flag)
 */
export function decodeChunk(bytes: Uint8Array): Map<number, NodeSolution> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== "TSR1") throw new Error("bad solution chunk");
  const count = dv.getUint32(4, true);
  let o = 8;
  const out = new Map<number, NodeSolution>();
  for (let n = 0; n < count; n++) {
    const id = dv.getUint32(o, true);
    const na = bytes[o + 4];
    const flags = bytes[o + 5];
    o += 6;
    const weight = new Float32Array(K);
    const equity = new Float32Array(K);
    for (let h = 0; h < K; h++) weight[h] = bytes[o + h] / 255;
    o += K;
    for (let h = 0; h < K; h++) equity[h] = bytes[o + h] / 255;
    o += K;
    const freq = new Float32Array(na * K);
    for (let h = 0; h < K; h++) {
      let sum = 0;
      for (let a = 0; a < na; a++) sum += bytes[o + a * K + h];
      for (let a = 0; a < na; a++) freq[a * K + h] = sum > 0 ? bytes[o + a * K + h] / sum : 1 / na;
    }
    o += na * K;
    const ev = new Float32Array(na * K);
    for (let i = 0; i < na * K; i++) ev[i] = dv.getInt16(o + i * 2, true) / 256;
    o += na * K * 2;
    let eqr: Float32Array | null = null;
    if (flags & 1) {
      eqr = new Float32Array(K);
      for (let h = 0; h < K; h++) eqr[h] = bytes[o + h] / 100;
      o += K;
    }
    out.set(id, { id, na, weight, equity, freq, ev, eqr });
  }
  return out;
}

/** gzip magic sniffing: some hosts transparently decompress `.gz` files. */
export function isGzip(b: Uint8Array) {
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
}

export async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buf);
  if (!isGzip(bytes)) return bytes;
  if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream is not supported by this browser");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
