/**
 * Continuing a preflop hand on a post-flop scenario (REFACTOR_PLAN step 2-4): lib/postflop/link.ts matches the line
 * the hand took against each scenario's `pre` (public/postflop/index.json), on the shipped data.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { linkedScenario, postflopLink } from "../postflop/link";
import { PF_INDEX } from "../postflop/loader";
import type { PfScenario } from "../postflop/loader";
import { SOLUTIONS } from "../solution/catalog";
import { parseManifest } from "../solution/decode";
import { preflopLine, resolvePreflopKey, ROOT_KEY } from "../solution/positionKey";
import { Terminal } from "../solution/types";
import type { Manifest } from "../solution/types";

const PUBLIC = path.resolve(__dirname, "../../../public");

/** the shipped preflop solution of a stack depth, found through the catalog */
function manifestAt(stack: number): Manifest {
  const entry = SOLUTIONS.find((s) => s.stack === stack);
  if (!entry) throw new Error(`the catalog has no ${stack}bb solution`);
  return parseManifest(JSON.parse(gunzipSync(readFileSync(path.join(PUBLIC, "solutions", entry.id, "manifest.json.gz"))).toString("utf8")));
}

const lastToken = (m: Manifest, nodeId: number, i: number) => {
  const line = preflopLine(m, nodeId, i);
  return line[line.length - 1]?.token;
};

/** the node and action that end a line such as "F-F-F-R2.5-F-C" (null when the solution does not have it) */
function endOf(m: Manifest, line: string): { nodeId: number; actionIndex: number } | null {
  const tokens = line.split("-");
  const nodeId = resolvePreflopKey(m, tokens.length > 1 ? tokens.slice(0, -1).join("-") : ROOT_KEY);
  if (nodeId === null) return null;
  const actionIndex = m.nodes[nodeId].actions.findIndex((_, i) => lastToken(m, nodeId, i) === tokens[tokens.length - 1]);
  return actionIndex < 0 ? null : { nodeId, actionIndex };
}

/** the full preflop line of a scenario: the longer of the two players' lines (the other one is a part of it) */
const fullLine = (sc: PfScenario) => (sc.pre!.oopPath.length > sc.pre!.ipPath.length ? sc.pre!.oopPath : sc.pre!.ipPath);

const m100 = manifestAt(100);

describe("the scenarios' connection to the preflop solution (pre)", () => {
  it("every shipped scenario says where it joins the preflop solution", () => {
    expect(PF_INDEX.scenarios.length).toBeGreaterThan(0);
    for (const sc of PF_INDEX.scenarios) {
      expect(sc.pre, sc.id).toBeDefined();
      const pre = sc.pre!;
      expect(SOLUTIONS.some((s) => s.stack === pre.stack), `${sc.id}: a ${pre.stack}bb preflop solution is shipped`).toBe(true);
      // the scenario's own seats are the ones it joins
      expect([pre.oopSeat, pre.ipSeat]).toEqual([sc.oop, sc.ip]);
      // one line is the other one's start: the player who acted last continues it
      const [short, long] = [pre.oopPath, pre.ipPath].sort((a, b) => a.length - b.length);
      expect(long.startsWith(`${short}-`), sc.id).toBe(true);
    }
  });

  it.each(PF_INDEX.scenarios.map((sc) => [sc.id, sc] as const))("%s: following its line in the preflop solution leads to it, for either player", (_, sc) => {
    const pre = sc.pre!;
    const m = manifestAt(pre.stack);
    const end = endOf(m, fullLine(sc));
    expect(end, `${fullLine(sc)} is a line of the ${pre.stack}bb solution`).not.toBeNull();
    const { nodeId, actionIndex } = end!;
    expect(m.nodes[nodeId].actions[actionIndex].term, "the line ends with a heads-up flop").toBe(Terminal.Flop);
    expect(linkedScenario(m, nodeId, actionIndex, PF_INDEX.scenarios)?.id).toBe(sc.id);
    const oop = m.players.indexOf(pre.oopSeat);
    const ip = m.players.indexOf(pre.ipSeat);
    expect(postflopLink(m, nodeId, actionIndex, oop, 14, PF_INDEX.scenarios, false, 0)).toEqual({ kind: "through", scenario: sc.id, hero: 0, streets: [0, 1, 2], rng: false, timer: 0, flop: null, heroClass: 14 });
    expect(postflopLink(m, nodeId, actionIndex, ip, 3, PF_INDEX.scenarios, true, 10)).toMatchObject({ scenario: sc.id, hero: 1, rng: true, timer: 10, heroClass: 3 });
    // a scenario that is not on offer is not linked
    expect(postflopLink(m, nodeId, actionIndex, oop, 14, PF_INDEX.scenarios.filter((x) => x.id !== sc.id), false, 0)).toBeNull();
  });
});

describe("continuing a preflop hand on the flop", () => {
  const ALL = PF_INDEX.scenarios;
  const at = (line: string) => {
    const e = endOf(m100, line);
    if (!e) throw new Error(`no line ${line}`);
    return e;
  };
  const link = (line: string, hero: number, scenarios: readonly PfScenario[] = ALL) => {
    const { nodeId, actionIndex } = at(line);
    return postflopLink(m100, nodeId, actionIndex, hero, 14, scenarios, false, 0);
  };
  const BTN = m100.players.indexOf("BTN");
  const BB = m100.players.indexOf("BB");

  it("recognises a single raised pot BTN vs BB and maps the seats", () => {
    expect(link("F-F-F-R2.5-F-C", BB)).toMatchObject({ kind: "through", scenario: "srp-btn-bb", hero: 0, heroClass: 14 });
    expect(link("F-F-F-R2.5-F-C", BTN)).toMatchObject({ scenario: "srp-btn-bb", hero: 1 });
  });

  it("recognises the 3-bet pot and refuses what is not solved", () => {
    expect(link("F-F-F-R2.5-F-R11-C", BB)?.scenario).toBe("3bp-btn-bb");
    expect(link("F-F-F-R2.5-F-R11-C", BB, ALL.filter((s) => s.id === "srp-btn-bb"))).toBeNull();
    // a seat that has folded is not the hero of the flop
    expect(link("F-F-F-R2.5-F-C", m100.players.indexOf("SB"))).toBeNull();
    // a three-way pot (the small blind calls too) is not covered
    expect(link("F-F-F-R2.5-C-C", BB)).toBeNull();
    // a heads-up pot no scenario covers (HJ open, BB call)
    expect(link("F-R2.5-F-F-F-C", BB)).toBeNull();
  });

  it("the open size comes from the scenario: another size is not linked, a scenario written for it is", () => {
    // the same tree with BTN's open at 3bb instead of 2.5
    const btnNode = resolvePreflopKey(m100, "F-F-F")!;
    const open = m100.nodes[btnNode].actions.findIndex((a) => a.to === 2.5);
    const m3: Manifest = { ...m100, nodes: m100.nodes.map((n) => (n.id === btnNode ? { ...n, actions: n.actions.map((a, i) => (i === open ? { ...a, to: 3 } : a)) } : n)) };
    const end = endOf(m3, "F-F-F-R3-F-C")!;
    expect(end).not.toBeNull();
    expect(linkedScenario(m3, end.nodeId, end.actionIndex, ALL)).toBeNull();
    const srp = ALL.find((s) => s.id === "srp-btn-bb")!;
    const moved: PfScenario = { ...srp, pre: { ...srp.pre!, oopPath: "F-F-F-R3-F-C", ipPath: "F-F-F-R3" } };
    expect(linkedScenario(m3, end.nodeId, end.actionIndex, [moved])?.id).toBe("srp-btn-bb");
  });

  it("a scenario joins only the preflop solution of its stack depth", () => {
    const srp = ALL.find((s) => s.id === "srp-btn-bb")!;
    const { nodeId, actionIndex } = at("F-F-F-R2.5-F-C");
    expect(linkedScenario({ ...m100, stack: 60 }, nodeId, actionIndex, ALL)).toBeNull();
    expect(linkedScenario(m100, nodeId, actionIndex, [{ ...srp, pre: undefined }])).toBeNull();
    for (const s of SOLUTIONS.filter((x) => x.stack !== 100)) {
      const m = manifestAt(s.stack);
      for (const node of m.nodes)
        node.actions.forEach((a, i) => {
          if (a.child < 0 && a.term === Terminal.Flop) expect(linkedScenario(m, node.id, i, ALL)).toBeNull();
        });
    }
  });

  it("on the shipped 100bb tree, links exactly the flops the old size-based check (2.5 / 11) linked", () => {
    // the check lib/postflop/link.ts made before step 2-4, kept here as the reference
    const old = (line: ReturnType<typeof preflopLine>): string | null => {
      const s = line[line.length - 1].after;
      const live = s.folded.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
      if (live.length !== 2) return null;
      const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
      if (live.includes(BTN) && live.includes(BB)) {
        if (s.level === 1 && close(s.inv[BTN], 2.5) && close(s.inv[BB], 2.5)) return "srp-btn-bb";
        if (s.level === 2 && close(s.inv[BTN], 11) && close(s.inv[BB], 11)) return "3bp-btn-bb";
      } else if (live.includes(m100.players.indexOf("CO")) && live.includes(BB) && s.level === 1 && close(s.inv[BB], 2.5)) return "srp-co-bb";
      return null;
    };
    let linked = 0;
    let flops = 0;
    for (const node of m100.nodes)
      node.actions.forEach((a, i) => {
        if (a.child >= 0 || a.term !== Terminal.Flop) return;
        flops++;
        const want = old(preflopLine(m100, node.id, i));
        expect(linkedScenario(m100, node.id, i, ALL)?.id ?? null, preflopLine(m100, node.id, i).map((x) => x.token).join("-")).toBe(want);
        if (want) linked++;
      });
    expect(linked).toBe(ALL.length);
    expect(flops).toBeGreaterThan(linked);
  });
});
