/**
 * Position keys (REFACTOR_PLAN step 1-2): for every node of every shipped solution
 * (5 preflop depths, 3 scenarios x 21 flops) key -> id -> key round-trips and no key repeats.
 */
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cardText, parseBoard } from "../postflop/combos";
import { decodeFlop } from "../postflop/decode";
import type { PfFlop } from "../postflop/decode";
import { flopKey, postflopKey, resolvePostflopKey } from "../postflop/positionKey";
import { contextAt, labelEdge, stepsTo } from "../postflop/replay";
import { parseManifest } from "../solution/decode";
import { DEPTHS, solutionId } from "../solution/loader";
import { keyAmount, preflopKey, resolvePreflopKey, ROOT_KEY } from "../solution/positionKey";
import { BB_SEAT, history, stateAt } from "../solution/tree";
import { ActionKind } from "../solution/types";
import type { Manifest } from "../solution/types";
import { renumberFlop, renumberManifest } from "./fixtures/renumber";

const PUBLIC = path.resolve(__dirname, "../../../public");
const TIMEOUT = 60_000;
const summary: string[] = [];

const PRE_KEY = /^(root|(F|X|C|[RA]\d+(\.\d{1,2})?)(-(F|X|C|[RA]\d+(\.\d{1,2})?))*)$/;
const POST_TOKEN = /^(F|X|C|[BRA]\d+(\.\d{1,2})?|[2-9TJQKA][cdhs])$/;
const BROKEN = ["", " ", "-", "/", "--", "F-", "-F", "F--F", "f", "root-F", "F-root", "R", "R2.50", "R2,5", "Rabc", "X/X", "undefined", "0", "12", "F-F-R2.5-F-F-C/Td", "💥"];

const loadManifest = (depth: number): Manifest =>
  parseManifest(JSON.parse(gunzipSync(readFileSync(path.join(PUBLIC, "solutions", solutionId(depth), "manifest.json.gz"))).toString("utf8")));
const loadFlop = (scenario: string, flop: number): PfFlop =>
  decodeFlop(new Uint8Array(gunzipSync(readFileSync(path.join(PUBLIC, "postflop", scenario, `${flop}.bin.gz`)))));

describe("keyAmount", () => {
  it("drops trailing zeros and is stable against floating-point noise", () => {
    expect(keyAmount(2.5)).toBe("2.5");
    expect(keyAmount(11)).toBe("11");
    expect(keyAmount(100)).toBe("100");
    expect(keyAmount(13.25)).toBe("13.25");
    expect(keyAmount(0.1 + 0.2)).toBe("0.3");
    expect(keyAmount(2.4999999999)).toBe("2.5");
    expect(keyAmount(Math.fround(7.43))).toBe("7.43");
    expect(keyAmount(1.75 + 1e-9)).toBe("1.75");
  });
});

describe.each(DEPTHS)("preflop position keys %dbb", (depth) => {
  const m = loadManifest(depth);

  it("every node: key -> id -> key, well-formed, unique in the solution", () => {
    const seen = new Map<string, number>();
    for (const n of m.nodes) {
      const key = preflopKey(m, n.id);
      expect(key, `node ${n.id}`).toMatch(PRE_KEY);
      expect(seen.get(key), `key ${key} of node ${n.id} is already used`).toBeUndefined();
      seen.set(key, n.id);
      const back = resolvePreflopKey(m, key);
      expect(back, key).toBe(n.id);
      expect(preflopKey(m, back!)).toBe(key);
    }
    expect(seen.size).toBe(m.nodes.length);
    expect(preflopKey(m, 0)).toBe(ROOT_KEY);
    summary.push(`preflop ${depth}bb: ${m.nodes.length} nodes, ${seen.size} distinct keys`);
  }, TIMEOUT);

  it("tokens say what was played: kind, total amount, check only when nothing is owed", () => {
    for (const n of m.nodes) {
      const tokens = n.id === 0 ? [] : preflopKey(m, n.id).split("-");
      const steps = history(m, n.id);
      expect(tokens.length).toBe(steps.length);
      steps.forEach((s, i) => {
        const t = tokens[i];
        if (s.action.kind === ActionKind.Fold) expect(t).toBe("F");
        else if (s.action.kind === ActionKind.Call) {
          const check = s.before.inv[s.actor] === s.before.cur;
          expect(t).toBe(check ? "X" : "C");
          if (check) expect(s.actor).toBe(BB_SEAT);
        } else {
          expect(t[0]).toBe(s.action.kind === ActionKind.AllIn ? "A" : "R");
          expect(Number(t.slice(1))).toBeCloseTo(s.action.to, 6);
          expect(Number(t.slice(1))).toBeCloseTo(s.after.cur, 6);
        }
      });
    }
  }, TIMEOUT);

  it("the key does not depend on node ids or chunks", () => {
    const { m: m2, map } = renumberManifest(m);
    let moved = 0;
    for (const n of m.nodes) {
      const key = preflopKey(m, n.id);
      expect(preflopKey(m2, map(n.id))).toBe(key);
      expect(resolvePreflopKey(m2, key)).toBe(map(n.id));
      if (map(n.id) !== n.id) moved++;
    }
    expect(moved).toBeGreaterThan(m.nodes.length / 2);
  }, TIMEOUT);

  it("returns null (and never throws) for keys that are not in the tree", () => {
    for (const k of BROKEN) expect(resolvePreflopKey(m, k), JSON.stringify(k)).toBeNull();
    expect(resolvePreflopKey(m, undefined as unknown as string)).toBeNull();
    expect(resolvePreflopKey(m, null as unknown as string)).toBeNull();
    expect(resolvePreflopKey(m, 3 as unknown as string)).toBeNull();
    expect(resolvePreflopKey({ ...m, nodes: [] }, ROOT_KEY)).toBeNull();
    // six folds: nobody is left to act
    expect(resolvePreflopKey(m, "F-F-F-F-F-F")).toBeNull();
    // a raise size this solution does not have, and the right size with a wrong letter
    expect(resolvePreflopKey(m, "R2.51")).toBeNull();
    expect(resolvePreflopKey(m, "A2.5")).toBeNull();
    expect(resolvePreflopKey(m, "B2.5")).toBeNull();
    // UTG cannot check, the first big-blind decision after a limp is a check and not a call
    expect(resolvePreflopKey(m, "X")).toBeNull();
    for (const n of m.nodes) {
      const key = preflopKey(m, n.id);
      // lines that end the hand or were pruned have no node; an extra separator or other case is not a key
      n.actions.forEach((a, i) => {
        if (a.child >= 0) return;
        const st = stateAt(m, n.id);
        const tok = a.kind === ActionKind.Fold ? "F" : a.kind === ActionKind.Call ? (st.inv[n.actor] === st.cur ? "X" : "C") : `${a.kind === ActionKind.AllIn ? "A" : "R"}${keyAmount(a.to)}`;
        expect(resolvePreflopKey(m, n.id === 0 ? tok : `${key}-${tok}`), `node ${n.id} action ${i}`).toBeNull();
      });
      if (n.id) {
        expect(resolvePreflopKey(m, `${key}-`)).toBeNull();
        expect(resolvePreflopKey(m, key.toLowerCase())).toBeNull();
        expect(resolvePreflopKey(m, key.replace(/-/g, "/"))).toBe(key.includes("-") ? null : n.id);
      }
    }
  }, TIMEOUT);
});

describe("preflop position keys across solutions", () => {
  const all = DEPTHS.map((d) => ({ depth: d, m: loadManifest(d) }));
  const m100 = all.find((x) => x.depth === 100)!.m;

  it("documented examples", () => {
    // CO opens to 2.5, BTN and SB fold: the big blind's decision
    const id = resolvePreflopKey(m100, "F-F-R2.5-F-F");
    expect(id).not.toBeNull();
    expect(m100.nodes[id!].actor).toBe(BB_SEAT);
    expect(stateAt(m100, id!).cur).toBe(2.5);
    // ... and its call ends the preflop betting, so there is no node behind it
    expect(resolvePreflopKey(m100, "F-F-R2.5-F-F-C")).toBeNull();
    // SB limps: the big blind may check
    const limp = resolvePreflopKey(m100, "F-F-F-F-C");
    expect(limp).not.toBeNull();
    expect(m100.nodes[limp!].actor).toBe(BB_SEAT);
    expect(stateAt(m100, limp!).limped).toBe(true);
  });

  it("a key of another solution resolves only where the same line exists, and then to the same line", () => {
    let missing = 0;
    let shared = 0;
    for (const a of all) for (const b of all) {
      if (a === b) continue;
      for (const n of a.m.nodes) {
        const key = preflopKey(a.m, n.id);
        const id = resolvePreflopKey(b.m, key);
        if (id === null) missing++;
        else {
          shared++;
          expect(preflopKey(b.m, id)).toBe(key);
        }
      }
    }
    // all-in sizes differ by depth, so some keys cannot exist elsewhere
    expect(missing).toBeGreaterThan(0);
    expect(shared).toBeGreaterThan(0);
    const allIn = all[0].m.nodes.map((n) => preflopKey(all[0].m, n.id)).find((k) => k.includes(`A${all[0].depth}`));
    expect(allIn).toBeDefined();
    expect(resolvePreflopKey(m100, allIn!)).toBeNull();
  }, TIMEOUT);
});

describe("postflop position keys", () => {
  const dir = path.join(PUBLIC, "postflop");
  const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as { flops: string[]; scenarios: { id: string }[] };
  const files: { scenario: string; flop: number }[] = [];
  for (const sc of index.scenarios) {
    for (const f of readdirSync(path.join(dir, sc.id)).filter((x) => x.endsWith(".bin.gz"))) files.push({ scenario: sc.id, flop: Number(f.split(".")[0]) });
  }
  files.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.flop - b.flop);
  let totalNodes = 0;

  it("covers every shipped flop (3 scenarios x 21 flops)", () => {
    expect(files.length).toBe(index.scenarios.length * index.flops.length);
    expect(files.length).toBe(63);
  });

  it("flopKey: board string without spaces, the same for any order of the cards, distinct per flop", () => {
    expect(flopKey(parseBoard("As 7d 2c"))).toBe("As7d2c");
    expect(flopKey(parseBoard("2c As 7d"))).toBe("As7d2c");
    expect(flopKey(parseBoard("8c 8d 3s"))).toBe("8d8c3s");
    expect(flopKey(parseBoard("Kd Ks 5c"))).toBe("KsKd5c");
    expect(flopKey(parseBoard("Kh Ks Kc"))).toBe("KsKhKc");
    const keys = index.flops.map((s) => flopKey(parseBoard(s)));
    expect(new Set(keys).size).toBe(index.flops.length);
    for (const k of keys) expect(k).toMatch(/^([2-9TJQKA][cdhs]){3}$/);
    for (const s of index.flops) {
      const [a, b, c] = parseBoard(s);
      const k = flopKey([a, b, c]);
      for (const p of [[a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]) expect(flopKey(p)).toBe(k);
      // the same cards as the index string, only reordered
      expect(k.match(/../g)!.sort()).toEqual(s.split(" ").sort());
    }
    // the board stored in each file is the flop of the index at that position
    for (const { scenario, flop } of files) expect(flopKey(loadFlop(scenario, flop).board), `${scenario}/${flop}`).toBe(keys[flop]);
  }, TIMEOUT);

  it("every node of every flop: key -> id -> key, well-formed, unique in the flop, independent of node ids", () => {
    for (const { scenario, flop } of files) {
      const f = loadFlop(scenario, flop);
      const where = `${scenario}/${flop}`;
      const { f: f2, map } = renumberFlop(f);
      const seen = new Map<string, number>();
      for (const n of f.nodes) {
        const key = postflopKey(f, n.id);
        if (seen.has(key)) expect.fail(`${where}: key ${key} of node ${n.id} is already used by node ${seen.get(key)}`);
        seen.set(key, n.id);
        if (resolvePostflopKey(f, key) !== n.id) expect.fail(`${where}: ${key} resolves to ${resolvePostflopKey(f, key)}, not ${n.id}`);
        if (postflopKey(f2, map(n.id)) !== key || resolvePostflopKey(f2, key) !== map(n.id)) expect.fail(`${where}: ${key} changes when nodes are renumbered`);

        // the key says what was played: one token per step, "/" around cards, "-" between actions
        const steps = stepsTo(f, n.id);
        if (n.id === 0) {
          expect(key).toBe(ROOT_KEY);
          continue;
        }
        const tokens = key.split(/[-/]/);
        const seps = key.replace(/[^-/]/g, "");
        expect(tokens.length, key).toBe(steps.length);
        steps.forEach((s, i) => {
          const t = tokens[i];
          if (!POST_TOKEN.test(t)) expect.fail(`${where}: bad token ${t} in ${key}`);
          const card = s.node.type === "chance";
          if (i > 0 && seps[i - 1] !== (card || steps[i - 1].node.type === "chance" ? "/" : "-")) expect.fail(`${where}: bad separator in ${key}`);
          if (card) {
            if (t !== cardText(s.edge.kind)) expect.fail(`${where}: ${key} token ${i} is not the dealt card`);
            return;
          }
          const label = labelEdge(f, s.node.id, s.edgeIndex);
          const letter = { fold: "F", check: "X", call: "C", bet: "B", raise: "R", allin: "A" }[label.key];
          const want = label.key === "bet" || label.key === "raise" || label.key === "allin" ? `${letter}${keyAmount(s.edge.amount)}` : letter;
          if (t !== want) expect.fail(`${where}: ${key} token ${i} is ${t}, the action is ${want}`);
        });
        // the cards in the key are the turn and river of the node's board
        const cards = tokens.filter((t) => /^[2-9TJQKA][cdhs]$/.test(t));
        expect(cards, key).toEqual(contextAt(f, n.id).board.slice(3).map(cardText));
      }
      expect(seen.size).toBe(f.nodes.length);
      totalNodes += f.nodes.length;
    }
    summary.push(`postflop: ${files.length} flops, ${totalNodes} nodes, all keys distinct inside their flop`);
  }, TIMEOUT);

  it("returns null (and never throws) for keys that are not in the tree", () => {
    for (const { scenario, flop } of files) {
      const f = loadFlop(scenario, flop);
      for (const k of [...BROKEN, "X-Td", "X-X-Td", "X/B1.75", "X-X/Td/", "/X", "X-X/td", "X-X/Tx", "X-X/1d"]) expect(resolvePostflopKey(f, k), `${scenario}/${flop} ${JSON.stringify(k)}`).toBeNull();
      expect(resolvePostflopKey(f, undefined as unknown as string)).toBeNull();
      expect(resolvePostflopKey(f, null as unknown as string)).toBeNull();
      expect(resolvePostflopKey({ ...f, nodes: [] }, ROOT_KEY)).toBeNull();
      const boardNow = (id: number) => contextAt(f, id).board;
      for (const n of f.nodes) {
        const key = postflopKey(f, n.id);
        const prefix = n.id === 0 ? "" : key;
        if (n.type === "chance") {
          // only a sample of turn / river cards is stored: any other card has no node
          const have = new Set(n.edges.map((e) => e.kind));
          const board = boardNow(n.id);
          let tried = 0;
          for (let c = 0; c < 52 && tried < 3; c++) {
            if (have.has(c) || board.includes(c)) continue;
            tried++;
            if (resolvePostflopKey(f, `${prefix}/${cardText(c)}`) !== null) expect.fail(`${scenario}/${flop}: ${prefix}/${cardText(c)} is not in the tree`);
          }
          // a card needs "/" and an action cannot follow a street's end
          for (const e of n.edges) if (resolvePostflopKey(f, `${prefix}-${cardText(e.kind)}`) !== null) expect.fail(`${scenario}/${flop}: "-" before a card accepted`);
          if (resolvePostflopKey(f, `${prefix}-X`) !== null || resolvePostflopKey(f, `${prefix}/X`) !== null) expect.fail(`${scenario}/${flop}: action after ${prefix} accepted`);
        } else {
          // a card cannot be dealt while a player still has to act
          if (resolvePostflopKey(f, `${prefix}/Td`) !== null && n.id !== 0) expect.fail(`${scenario}/${flop}: card after ${prefix} accepted`);
        }
        if (n.id && resolvePostflopKey(f, key.toLowerCase()) !== null) expect.fail(`${scenario}/${flop}: lower-case ${key} accepted`);
      }
    }
  }, TIMEOUT);

  it("a key of another flop or scenario resolves only to the same line, or to null", () => {
    const a = loadFlop("srp-btn-bb", 0);
    const b = loadFlop("srp-btn-bb", 1);
    const c = loadFlop("3bp-btn-bb", 0);
    let missing = 0;
    for (const [from, to] of [[a, b], [b, a], [a, c], [c, a]] as const) {
      for (const n of from.nodes) {
        const key = postflopKey(from, n.id);
        const id = resolvePostflopKey(to, key);
        if (id === null) missing++;
        else expect(postflopKey(to, id)).toBe(key);
      }
    }
    expect(missing).toBeGreaterThan(0);
    // bet sizes of the 3-bet pot do not exist in the single-raised pot
    const bet3bp = c.nodes.map((n) => postflopKey(c, n.id)).find((k) => /^B\d/.test(k) && !a.nodes[0].edges.some((e) => `B${keyAmount(e.amount)}` === k.split(/[-/]/)[0]));
    expect(bet3bp).toBeDefined();
    expect(resolvePostflopKey(a, bet3bp!)).toBeNull();
  }, TIMEOUT);

  it("documented example shape: actions, card, actions, card, action", () => {
    const f = loadFlop("srp-btn-bb", 0);
    const river = f.nodes.map((n) => postflopKey(f, n.id)).filter((k) => k.split("/").length === 5);
    expect(river.length).toBeGreaterThan(0);
    for (const k of river) expect(k).toMatch(/^[^/]+\/[2-9TJQKA][cdhs]\/[^/]+\/[2-9TJQKA][cdhs]\/[^/]+$/);
    // first decision on a turn card: the key ends with the card
    const turnStart = f.nodes.find((n) => n.type === "decision" && n.parent >= 0 && f.nodes[n.parent].type === "chance" && n.street === 1)!;
    expect(postflopKey(f, turnStart.id)).toMatch(/^[^/]+\/[2-9TJQKA][cdhs]$/);
    expect(postflopKey(f, turnStart.parent)).toBe(postflopKey(f, turnStart.id).split("/")[0]);
  });
});

afterAll(() => {
  if (summary.length) console.log(`position keys:\n  ${summary.join("\n  ")}`);
});
