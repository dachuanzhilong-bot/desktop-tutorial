import { preflopLine, lineKey } from "../solution/positionKey";
import type { LineStep } from "../solution/positionKey";
import { Terminal } from "../solution/types";
import type { Manifest } from "../solution/types";
import type { PfScenario } from "./loader";
import { ALL_STREETS, HERO_IP, HERO_OOP } from "./types";
import type { PostConfig } from "./types";

/** the line of `seat` through its last action, as a key; null when it never acted */
function lineThrough(line: readonly LineStep[], seat: number): string | null {
  for (let i = line.length - 1; i >= 0; i--) if (line[i].actor === seat) return lineKey(line, i + 1);
  return null;
}

/**
 * The post-flop scenario a preflop hand goes on to when it ends with action `actionIndex` of node `nodeId`, or null.
 * It is the scenario whose `pre` (written with the post-flop solutions: public/postflop/index.json) names this
 * solution's stack, the two seats left and, for each of them, their line through their last preflop action, as
 * position keys (lib/solution/positionKey.ts). Nothing about bet sizes is assumed here: when the preflop sizes
 * change, the scenarios' `pre` says which lines they continue.
 */
export function linkedScenario(m: Manifest, nodeId: number, actionIndex: number, scenarios: readonly PfScenario[]): PfScenario | null {
  const action = m.nodes[nodeId]?.actions[actionIndex];
  if (!action || action.child >= 0 || action.term !== Terminal.Flop) return null;
  const line = preflopLine(m, nodeId, actionIndex);
  const end = line[line.length - 1].after;
  const live = end.folded.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  for (const sc of scenarios) {
    const pre = sc.pre;
    if (!pre || pre.stack !== m.stack) continue;
    const oop = m.players.indexOf(pre.oopSeat);
    const ip = m.players.indexOf(pre.ipSeat);
    // exactly these two seats are left
    if (oop < 0 || ip < 0 || oop === ip || !live.includes(oop) || !live.includes(ip) || live.some((s) => s !== oop && s !== ip)) continue;
    if (lineThrough(line, oop) === pre.oopPath && lineThrough(line, ip) === pre.ipPath) return sc;
  }
  return null;
}

/**
 * When a preflop hand ends with a heads-up flop that the postflop solutions cover, returns the
 * config that continues the same hand on the flop (same seat, same hand class).
 * `nodeId` / `actionIndex`: the action that ended the preflop betting.
 */
export function postflopLink(m: Manifest, nodeId: number, actionIndex: number, heroSeat: number, heroClass: number, scenarios: readonly PfScenario[], rng: boolean, timer: number): PostConfig | null {
  const sc = linkedScenario(m, nodeId, actionIndex, scenarios);
  if (!sc?.pre) return null;
  const seat = m.players[heroSeat];
  const hero = seat === sc.pre.oopSeat ? HERO_OOP : seat === sc.pre.ipSeat ? HERO_IP : null;
  if (hero === null) return null;
  return { kind: "through", scenario: sc.id, hero, streets: [...ALL_STREETS], rng, timer, flop: null, heroClass };
}
