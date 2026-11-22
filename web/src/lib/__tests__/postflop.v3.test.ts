import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boardAt, decodeFlop, dense, denseRange, RANGE_Q, riverStartRanges } from "../postflop/decode";
import { COMBOS, NC } from "../postflop/combos";
import { loadV2Flop } from "./helpers";

/**
 * `TSP1` v3 (REFACTOR_PLAN 3-3-5): a small file written by the solver (test `v3_fixture_for_the_web_tests` in
 * solver/src/measure.rs) and what the solver's reader found in it (`tsp1-v3.json`).
 */
const FIX = path.resolve(__dirname, "fixtures");
const bytes = new Uint8Array(readFileSync(path.join(FIX, "tsp1-v3.bin")));
interface Want {
  version: number;
  board: number[];
  pot: number;
  stack: number;
  nodes: number;
  decisions: { id: number; street: number; actor: number; n: number; weightSum: number }[];
  riverStarts: { id: number; inv: [number, number]; reach: number; board: number[]; n: [number, number]; sum: [number, number]; card: number; dealtN: [number, number]; dealtSum: [number, number] }[];
}
const want: Want = JSON.parse(readFileSync(path.join(FIX, "tsp1-v3.json"), "utf8"));
const sum = (v: Float32Array) => v.reduce((a, b) => a + b, 0);
const count = (v: Float32Array) => v.reduce((a, b) => a + (b > 0 ? 1 : 0), 0);

describe("TSP1 v3", () => {
  const f = decodeFlop(bytes);

  it("reads the header and the flop / turn decision nodes with the v2 API", () => {
    expect(f.version).toBe(3);
    expect(f.board).toEqual(want.board);
    expect(f.pot).toBeCloseTo(want.pot, 6);
    expect(f.stack).toBeCloseTo(want.stack, 6);
    expect(f.nodes).toHaveLength(want.nodes);
    const decisions = f.nodes.filter((n) => n.type === "decision");
    expect(decisions.map((n) => n.id)).toEqual(want.decisions.map((d) => d.id));
    for (const d of want.decisions) {
      const n = f.nodes[d.id];
      expect([n.street, n.actor, n.data!.n]).toEqual([d.street, d.actor, d.n]);
      expect(sum(n.data!.weight)).toBeCloseTo(d.weightSum, 4);
      const dn = dense(n)!;
      for (let h = 0; h < NC; h++) if (dn.present[h]) expect(Array.from({ length: dn.na }, (_, a) => dn.freq[a * NC + h]).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 5);
    }
    // no river node: the river is solved on the device
    expect(f.nodes.every((n) => n.street < 2)).toBe(true);
  });

  it("reads the river starts: reach ranges, linked to the turn lines", () => {
    const starts = f.nodes.filter((n) => n.riverStart);
    expect(starts.map((n) => n.id)).toEqual(want.riverStarts.map((r) => r.id));
    for (const w of want.riverStarts) {
      const n = f.nodes[w.id];
      expect(n.type).toBe("chance");
      expect(n.street).toBe(1);
      expect(n.edges).toHaveLength(0);
      expect(n.inv).toEqual(w.inv);
      expect(n.reach).toBeCloseTo(w.reach, 5);
      expect(f.nodes[n.parent].edges[n.parentEdge].code).toBe(n.id);
      expect(boardAt(f, n.id)).toEqual(w.board);
      const [oop, ip] = n.riverStart!;
      expect([oop.hands.length, ip.hands.length]).toEqual(w.n);
      expect(sum(denseRange(oop))).toBeCloseTo(w.sum[0], 4);
      expect(sum(denseRange(ip))).toBeCloseTo(w.sum[1], 4);
      for (const r of [oop, ip]) {
        expect(Math.max(...r.q)).toBe(RANGE_Q); // the largest value is the scale
        expect(r.q.every((q) => q > 0)).toBe(true); // combos quantized to 0 are left out
        for (const h of r.hands) for (const c of w.board) expect(COMBOS[h].c1 !== c && COMBOS[h].c2 !== c).toBe(true);
      }
    }
  });

  it("gives the ranges for a river card with its combos removed", () => {
    for (const w of want.riverStarts) {
      const r = riverStartRanges(f, w.id, w.card)!;
      expect([count(r[0]), count(r[1])]).toEqual(w.dealtN);
      expect(sum(r[0])).toBeCloseTo(w.dealtSum[0], 4);
      expect(sum(r[1])).toBeCloseTo(w.dealtSum[1], 4);
      for (let h = 0; h < NC; h++) if (COMBOS[h].c1 === w.card || COMBOS[h].c2 === w.card) expect(r[0][h] + r[1][h]).toBe(0);
      // a card that blocks nothing in the ranges leaves them as stored
      const free = Array.from({ length: 52 }, (_, c) => c).find((c) => !w.board.includes(c) && [0, 1].every((p) => f.nodes[w.id].riverStart![p].hands.every((h) => COMBOS[h].c1 !== c && COMBOS[h].c2 !== c)));
      if (free !== undefined) expect(Array.from(riverStartRanges(f, w.id, free)![0])).toEqual(Array.from(denseRange(f.nodes[w.id].riverStart![0])));
    }
    const w = want.riverStarts[0];
    expect(riverStartRanges(f, w.id, w.board[3])).toBeNull(); // the turn card
    expect(riverStartRanges(f, w.id, w.board[0])).toBeNull(); // a flop card
    expect(riverStartRanges(f, w.id, 52)).toBeNull();
    expect(riverStartRanges(f, want.decisions[0].id, w.card)).toBeNull(); // not a river start
  });

  it("refuses damaged files", () => {
    expect(() => decodeFlop(bytes.slice(0, bytes.length - 1))).toThrow();
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    expect(() => decodeFlop(longer)).toThrow();
    const asV2 = bytes.slice();
    asV2[4] = 2; // a river start cannot be in a v2 file
    expect(() => decodeFlop(asV2)).toThrow();
    const v4 = bytes.slice();
    v4[4] = 4;
    expect(() => decodeFlop(v4)).toThrow();
  });

  it("still reads v2 files (the data shipped before 3-3-7, kept as a fixture) as version 2", () => {
    const v2 = loadV2Flop("srp-btn-bb", 0);
    expect(v2.version).toBe(2);
    expect(v2.nodes.some((n) => n.street === 2)).toBe(true);
    expect(v2.nodes.every((n) => n.riverStart === undefined)).toBe(true);
  });

  it("the shipped files are all v3 (REFACTOR_PLAN 3-3-7): river starts with reach ranges, no river node", () => {
    const dir = path.resolve(__dirname, "../../../public/postflop");
    const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as { flops: string[]; scenarios: { id: string }[] };
    let files = 0;
    for (const sc of index.scenarios)
      for (let i = 0; i < index.flops.length; i++) {
        const f = decodeFlop(new Uint8Array(gunzipSync(readFileSync(path.join(dir, sc.id, `${i}.bin.gz`)))));
        expect(f.version, `${sc.id}/${i}`).toBe(3);
        expect(f.nodes.some((n) => n.street === 2), `${sc.id}/${i}`).toBe(false);
        expect(f.nodes.some((n) => n.riverStart), `${sc.id}/${i}`).toBe(true);
        files++;
      }
    expect(files).toBe(63);
  });
});
