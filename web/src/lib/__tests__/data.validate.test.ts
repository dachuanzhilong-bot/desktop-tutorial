/**
 * Validates every solution file the app ships (npm run validate:data; also part of npm test).
 *
 * Preflop (every stack depth): tree structure, legal bet sizes (min-raise, stack cap), chip accounting,
 * raw per-hand frequencies summing to 100% *before* the decoder normalises them, values in range,
 * finite EVs, and ranges that follow from the frequencies played earlier on the same line.
 * Postflop (every scenario x flop): raw frequency sums, combos never blocked by the board, value ranges.
 * Equity table: size, symmetry, known match-ups.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_CLASSES, NUM_CLASSES } from "../poker/hands";
import { COMBOS, NC } from "../postflop/combos";
import { decodeFlop } from "../postflop/decode";
import { decodeChunk, parseManifest } from "../solution/decode";
import { flopBuild } from "../postflop/loader";
import { DEPTHS, solutionBuild, solutionId } from "../solution/loader";
import { applyAction, initialState, stateAt as stateAtNode } from "../solution/tree";
import { ActionKind } from "../solution/types";
import type { Manifest, NodeSolution, PublicState } from "../solution/types";

const PUBLIC = path.resolve(__dirname, "../../../public");
const K = NUM_CLASSES;
const summary: string[] = [];

/** collects failed checks (one expect per test instead of millions keeps the runner responsive) */
function checker() {
  const problems: string[] = [];
  const check = (ok: boolean, msg: () => string) => {
    if (!ok && problems.length < 50) problems.push(msg());
  };
  const done = () => expect(problems, problems.slice(0, 10).join("\n")).toEqual([]);
  return { check, done };
}

/** raw (un-normalised) frequency byte sums per node and hand, read straight from a TSR1 chunk */
function rawFreqSums(bytes: Uint8Array): Map<number, { na: number; sums: number[]; weight: number[] }> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(4, true);
  let o = 8;
  const out = new Map<number, { na: number; sums: number[]; weight: number[] }>();
  for (let n = 0; n < count; n++) {
    const id = dv.getUint32(o, true);
    const na = bytes[o + 4];
    const flags = bytes[o + 5];
    o += 6;
    const weight = Array.from(bytes.subarray(o, o + K));
    o += 2 * K; // weight + equity
    const sums = new Array(K).fill(0);
    for (let a = 0; a < na; a++) for (let h = 0; h < K; h++) sums[h] += bytes[o + a * K + h];
    o += na * K + na * K * 2 + (flags & 1 ? K : 0);
    out.set(id, { na, sums, weight });
  }
  expect(o, "chunk length matches its records").toBe(bytes.length);
  return out;
}

describe.each(DEPTHS)("preflop solution %dbb", (depth) => {
  const dir = path.join(PUBLIC, "solutions", solutionId(depth));
  it("ships", () => expect(existsSync(path.join(dir, "manifest.json.gz"))).toBe(true));
  if (!existsSync(path.join(dir, "manifest.json.gz"))) return;
  const m: Manifest = parseManifest(JSON.parse(gunzipSync(readFileSync(path.join(dir, "manifest.json.gz"))).toString("utf8")));
  const nodes = new Map<number, NodeSolution>();
  const raw = new Map<number, { na: number; sums: number[]; weight: number[] }>();
  for (let c = 0; c < m.chunks.length; c++) {
    const bytes = new Uint8Array(gunzipSync(readFileSync(path.join(dir, `chunk-${c}.bin.gz`))));
    for (const [id, s] of decodeChunk(bytes)) nodes.set(id, s);
    for (const [id, r] of rawFreqSums(bytes)) raw.set(id, r);
  }

  it("has data for every decision node, and a consistent tree", () => {
    expect(m.stack).toBe(depth);
    expect(m.blinds).toEqual([0.5, 1]);
    expect(nodes.size).toBe(m.nodes.length);
    for (const n of m.nodes) {
      expect(nodes.get(n.id)?.na, `node ${n.id}`).toBe(n.actions.length);
      if (n.actions.length < 2) {
        // the model allows one caller of an all-in: anyone after that call can only fold (never asked in practice)
        const st = stateAtNode(m, n.id);
        expect(n.actions.map((a) => a.kind), `node ${n.id}`).toEqual([ActionKind.Fold]);
        expect(st.cur).toBeCloseTo(depth, 6);
        expect(st.callers.length).toBeGreaterThan(0);
      }
      n.actions.forEach((a, i) => {
        if (a.child >= 0) {
          expect(m.nodes[a.child].parent).toBe(n.id);
          expect(m.nodes[a.child].parentAction).toBe(i);
        }
      });
      if (n.id) expect(n.parent).toBeGreaterThanOrEqual(0);
    }
  });

  it("bets are legal: raises reach at least the minimum raise, nothing exceeds the stack, chips add up", () => {
    const { check, done } = checker();
    let checked = 0;
    const walk = (id: number, st: PublicState, lastInc: number) => {
      const n = m.nodes[id];
      for (const a of n.actions) {
        const next = applyAction(st, n.actor, a);
        check(Math.max(...next.inv) <= depth + 1e-6, () => `node ${id}: more than the stack invested`);
        check(Math.abs(next.pot - next.inv.reduce((x, y) => x + y, 0)) < 1e-6, () => `node ${id}: pot != sum of bets`);
        let inc = lastInc;
        if (a.kind === ActionKind.Raise || a.kind === ActionKind.AllIn) {
          check(a.to > st.cur, () => `node ${id}: raise to ${a.to} is not above the current bet ${st.cur}`);
          if (a.kind === ActionKind.Raise) check(a.to - st.cur >= lastInc - 1e-6, () => `node ${id}: raise to ${a.to} is below the minimum raise`);
          if (a.kind === ActionKind.AllIn) check(Math.abs(a.to - depth) < 1e-6, () => `node ${id}: all-in to ${a.to} != stack ${depth}`);
          inc = Math.max(lastInc, a.to - st.cur);
        }
        if (a.kind === ActionKind.Call) check(Math.abs(next.inv[n.actor] - st.cur) < 1e-6, () => `node ${id}: call does not match the bet`);
        if (a.kind === ActionKind.Fold) check(next.inv[n.actor] === st.inv[n.actor], () => `node ${id}: fold changed the investment`);
        checked++;
        if (a.child >= 0) walk(a.child, next, inc);
      }
    };
    walk(0, initialState(m), m.blinds[1]);
    expect(checked).toBeGreaterThan(m.nodes.length);
    done();
  });

  it("every hand's raw frequencies add up to 100% and all values are in range", () => {
    const { check, done } = checker();
    let hands = 0;
    for (const n of m.nodes) {
      const r = raw.get(n.id)!;
      const s = nodes.get(n.id)!;
      for (let h = 0; h < K; h++) {
        if (r.weight[h] > 0) {
          // stored as bytes: rounding may move the total by at most one step per action
          check(Math.abs(r.sums[h] - 255) <= r.na, () => `node ${n.id} ${ALL_CLASSES[h].name}: frequencies add up to ${((100 * r.sums[h]) / 255).toFixed(1)}%`);
          hands++;
        }
        check(s.weight[h] >= 0 && s.weight[h] <= 1, () => `node ${n.id} ${ALL_CLASSES[h].name}: weight ${s.weight[h]}`);
        check(s.equity[h] >= 0 && s.equity[h] <= 1, () => `node ${n.id} ${ALL_CLASSES[h].name}: equity ${s.equity[h]}`);
        for (let a = 0; a < s.na; a++) {
          const ev = s.ev[a * K + h];
          // never win more than the opponents' stacks or lose more than one's own stack
          check(Number.isFinite(ev) && ev >= -depth - 1e-3 && ev <= 5 * depth + 1.5, () => `node ${n.id} ${ALL_CLASSES[h].name}: EV ${ev}`);
        }
      }
    }
    done();
    summary.push(`${depth}bb: ${m.nodes.length} decisions, ${hands} hand rows`);
  });

  it("every player is dealt every hand, and ranges follow from the frequencies played earlier", () => {
    const { check, done } = checker();
    for (const n of m.nodes) {
      // the previous decision of the same player on this line
      let child = n.id;
      let p = n.parent;
      while (p >= 0 && m.nodes[p].actor !== n.actor) {
        child = p;
        p = m.nodes[p].parent;
      }
      const s = nodes.get(n.id)!;
      if (p < 0) {
        for (let h = 0; h < K; h++) check(Math.abs(s.weight[h] - 1) < 0.005, () => `node ${n.id}: first decision of seat ${n.actor} but ${ALL_CLASSES[h].name} weight ${s.weight[h]}`);
        continue;
      }
      const prev = nodes.get(p)!;
      const ai = m.nodes[child].parentAction;
      for (let h = 0; h < K; h++) {
        const expected = prev.weight[h] * prev.freq[ai * K + h];
        check(Math.abs(s.weight[h] - expected) <= 0.02, () => `node ${n.id} ${ALL_CLASSES[h].name}: range ${s.weight[h].toFixed(3)} but the earlier play gives ${expected.toFixed(3)}`);
      }
    }
    done();
  });
});

/** build ID as scripts/build-id.mjs defines it, computed here on its own: SHA-256 of the packed bytes, first 12 hex digits */
function buildOf(files: string[]): string {
  const h = createHash("sha256");
  for (const f of files) h.update(readFileSync(f));
  return h.digest("hex").slice(0, 12);
}

describe("build IDs of the solution data", () => {
  const dir = path.join(PUBLIC, "solutions");
  const index: { solutions: { id: string; files: string[]; build?: string }[] } = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8"));

  it("the index lists every shipped depth", () => {
    expect(index.solutions.map((s) => s.id).sort()).toEqual(DEPTHS.map(solutionId).sort());
  });

  it.each(index.solutions)("preflop $id: the build of the index is the hash of its files", ({ id, files, build }) => {
    const names = readdirSync(path.join(dir, id)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(files.map((f) => f.replace(`/solutions/${id}/`, "")).sort(), "the index lists the files of the directory").toEqual(names);
    expect(build).toMatch(/^[0-9a-f]{12}$/);
    expect(build).toBe(buildOf(names.map((f) => path.join(dir, id, f))));
    expect(solutionBuild(id), "the loader asks for this build").toBe(build);
  });

  it("no two solutions share a build", () => {
    expect(new Set(index.solutions.map((s) => s.build)).size).toBe(index.solutions.length);
  });

  it("postflop: the build of every scenario x flop is the hash of its file, and nothing else is listed", () => {
    const pf = path.join(PUBLIC, "postflop");
    const idx: { flops: string[]; scenarios: { id: string }[]; build?: Record<string, string> } = JSON.parse(readFileSync(path.join(pf, "index.json"), "utf8"));
    const expected: Record<string, string> = {};
    for (const sc of idx.scenarios) for (let i = 0; i < idx.flops.length; i++) expected[`${sc.id}/${i}`] = buildOf([path.join(pf, sc.id, `${i}.bin.gz`)]);
    expect(idx.build).toEqual(expected);
    for (const sc of idx.scenarios) for (let i = 0; i < idx.flops.length; i++) expect(flopBuild(sc.id, i), "the loader asks for this build").toBe(expected[`${sc.id}/${i}`]);
  });
});

describe("postflop solutions", () => {
  const dir = path.join(PUBLIC, "postflop");
  const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8"));
  const files: { scenario: string; flop: number }[] = [];
  for (const sc of index.scenarios as { id: string }[]) {
    for (const f of readdirSync(path.join(dir, sc.id)).filter((x) => x.endsWith(".bin.gz"))) files.push({ scenario: sc.id, flop: Number(f.split(".")[0]) });
  }

  it("every scenario of the index has its flops", () => {
    for (const sc of index.scenarios as { id: string }[]) expect(files.filter((f) => f.scenario === sc.id).length, sc.id).toBe(index.flops.length);
  });

  it.each(files)("$scenario flop $flop: raw frequencies sum to 100%, no combo uses a board card, values in range", ({ scenario, flop }) => {
    const bytes = new Uint8Array(gunzipSync(readFileSync(path.join(dir, scenario, `${flop}.bin.gz`))));
    const f = decodeFlop(bytes);
    const { check, done } = checker();
    expect(new Set(f.board).size).toBe(3);
    let rows = 0;
    for (const n of f.nodes) {
      check(Math.max(n.inv[0], n.inv[1]) <= f.stack + f.pot / 2 + 1e-3, () => `node ${n.id}: more than the stack invested`);
      if (!n.data) continue;
      const d = n.data;
      const na = n.edges.length;
      const seen = new Set<number>();
      for (let j = 0; j < d.n; j++) {
        const h = d.hands[j];
        check(h < NC && !seen.has(h), () => `node ${n.id}: combo ${h} invalid or listed twice`);
        seen.add(h);
        const { c1, c2 } = COMBOS[h];
        check(!f.board.includes(c1) && !f.board.includes(c2), () => `node ${n.id}: combo ${h} uses a board card`);
        check(d.weight[j] >= 0 && d.weight[j] <= 1, () => `node ${n.id}: weight ${d.weight[j]}`);
        check(d.eq[j] >= 0 && d.eq[j] <= 1, () => `node ${n.id}: equity ${d.eq[j]}`);
        let s = 0;
        for (let a = 0; a < na; a++) s += d.freq[a * d.n + j];
        check(Math.abs(s - 1) < 1e-4, () => `node ${n.id}: frequencies add up to ${s}`);
        rows++;
      }
    }
    // raw byte sums: re-read the frequency block of every decision node
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 5;
    const nb = bytes[o++];
    o += nb + 8;
    const count = dv.getUint16(o, true);
    o += 2;
    for (let id = 0; id < count; id++) {
      o += 1 + 8;
      const kind = bytes[o++];
      o += 1 + 4;
      const ne = bytes[o++];
      o += ne * 9;
      if (kind !== 0) continue;
      let n = 0;
      for (let h = 0; h < NC; h++) if (bytes[o + (h >> 3)] & (1 << (h & 7))) n++;
      o += Math.ceil(NC / 8) + 2 * n;
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let a = 0; a < ne; a++) s += bytes[o + a * n + j];
        check(Math.abs(s - 255) <= ne, () => `node ${id} combo #${j}: raw frequencies add up to ${((100 * s) / 255).toFixed(1)}%`);
      }
      o += ne * n + 2 * n + ne * n;
    }
    expect(o).toBe(bytes.length);
    done();
    summary.push(`${scenario}/${flop}: ${f.nodes.length} nodes, ${rows} combo rows`);
  });
});

describe("equity table (public/data/equity169.bin)", () => {
  const buf = readFileSync(path.join(PUBLIC, "data/equity169.bin"));
  const t = new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  
  it("is 169 x 169 and symmetric (equity of A vs B + B vs A = 1)", () => {
    expect(t.length).toBe(K * K);
    const { check, done } = checker();
    for (let i = 0; i < K; i++) {
      check(Math.abs(t[i * K + i] / 65535 - 0.5) < 0.05, () => `${ALL_CLASSES[i].name} vs itself: ${t[i * K + i] / 65535}`);
      for (let j = 0; j < K; j++) check(Math.abs(t[i * K + j] / 65535 + t[j * K + i] / 65535 - 1) < 0.004, () => `${ALL_CLASSES[i].name} vs ${ALL_CLASSES[j].name} is not symmetric`);
    }
    done();
    summary.push(`equity table: ${K * K} match-ups`);
  });
});

afterAll(() => {
  if (summary.length) console.log(`validated:\n  ${summary.join("\n  ")}`);
});
