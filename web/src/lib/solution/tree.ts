import type { Key } from "../i18n/ja";
import { ActionKind, Terminal } from "./types";
import { bbSeat, sbSeat, seatNames } from "./seats";
import type { ActionMeta, Manifest, NodeMeta, PublicState, SpotType } from "./types";

/**
 * The 6-seat table of the shipped solutions (lib/solution/seats.ts gives any table size). Only for places that show a
 * stored 6-max seat number without its manifest (home, stats, post-flop records); everything that has a manifest
 * takes the seats from manifest.players instead.
 */
export const SEATS = seatNames(6) as readonly string[];
/** small / big blind seat of the 6-seat table; with a manifest use sbSeat / bbSeat(manifest.players.length) */
export const SB_SEAT = sbSeat(SEATS.length);
export const BB_SEAT = bbSeat(SEATS.length);

/** the table before the first action: the blinds posted by the last two seats (manifest.players gives the table size) */
export function initialState(m: Pick<Manifest, "blinds" | "players">): PublicState {
  const n = m.players.length;
  const inv = new Array<number>(n).fill(0);
  inv[sbSeat(n)] = m.blinds[0];
  inv[bbSeat(n)] = m.blinds[1];
  return { inv, folded: new Array<boolean>(n).fill(false), pot: m.blinds[0] + m.blinds[1], cur: m.blinds[1], level: 0, lastRaiser: null, callers: [], limped: false };
}

/** apply one action of `actor` to a public state (pure) */
export function applyAction(s: PublicState, actor: number, a: ActionMeta): PublicState {
  const inv = s.inv.slice();
  const folded = s.folded.slice();
  let { cur, level, lastRaiser, callers, limped } = s;
  callers = callers.slice();
  switch (a.kind) {
    case ActionKind.Fold:
      folded[actor] = true;
      break;
    case ActionKind.Call:
      inv[actor] = cur;
      if (level > 0) callers.push(actor);
      else limped = true;
      break;
    default:
      inv[actor] = a.to;
      cur = a.to;
      level += 1;
      lastRaiser = actor;
      callers = [];
  }
  return { inv, folded, pot: inv.reduce((x, y) => x + y, 0), cur, level, lastRaiser, callers, limped };
}

/** nodes from the root to `id` inclusive */
export function pathNodes(m: Manifest, id: number): NodeMeta[] {
  const out: NodeMeta[] = [];
  let cur = m.nodes[id];
  while (cur) {
    out.push(cur);
    cur = cur.parent >= 0 ? m.nodes[cur.parent] : (undefined as unknown as NodeMeta);
  }
  return out.reverse();
}

export interface Step {
  node: NodeMeta;
  actionIndex: number;
  action: ActionMeta;
  actor: number;
  /** state before the action */
  before: PublicState;
  after: PublicState;
}

/** actions taken to reach node `id` (excludes the decision at `id` itself) */
export function history(m: Manifest, id: number): Step[] {
  const nodes = pathNodes(m, id);
  const steps: Step[] = [];
  let s = initialState(m);
  for (let i = 0; i < nodes.length - 1; i++) {
    const n = nodes[i];
    const ai = nodes[i + 1].parentAction;
    const a = n.actions[ai];
    const after = applyAction(s, n.actor, a);
    steps.push({ node: n, actionIndex: ai, action: a, actor: n.actor, before: s, after });
    s = after;
  }
  return steps;
}

export function stateAt(m: Manifest, id: number): PublicState {
  const h = history(m, id);
  return h.length ? h[h.length - 1].after : initialState(m);
}

/** short label of an action, e.g. "Fold", "Call", "Raise", "All-in" */
export function actionLabel(a: ActionMeta, actor: number, state: PublicState, t: (k: Key) => string): string {
  switch (a.kind) {
    case ActionKind.Fold:
      return t("act.fold");
    case ActionKind.Call:
      // the big blind is the last seat of the table (the state has one entry per seat)
      if (state.level === 0) return actor === bbSeat(state.inv.length) ? t("act.check") : t("act.limp");
      return t("act.call");
    case ActionKind.AllIn:
      return t("act.allin");
    default:
      return t("act.raise");
  }
}

export function fmtBB(x: number, digits = 1): string {
  const r = Math.round(x * 10 ** digits) / 10 ** digits;
  return Number.isInteger(r) ? String(r) : r.toFixed(digits);
}

/** classify the decision at `id` for filtering, heat-maps and drills */
export function spotType(m: Manifest, id: number): SpotType {
  const s = stateAt(m, id);
  const node = m.nodes[id];
  if (s.level === 0) return node.actor === bbSeat(m.players.length) && s.limped ? "limp" : "rfi";
  if (s.level === 1) return s.callers.length > 0 ? "squeeze" : "vsOpen";
  if (s.level === 2) {
    // was there a flat call before the 3-bet? then the 3-bet is a squeeze
    const hist = history(m, id);
    const firstRaise = hist.findIndex((h) => h.action.kind === ActionKind.Raise || h.action.kind === ActionKind.AllIn);
    const flatBefore = hist.slice(firstRaise + 1).some((h) => h.action.kind === ActionKind.Call && h.before.level === 1);
    return flatBefore ? "vsSqueeze" : "vs3bet";
  }
  if (s.level === 3) return "vs4bet";
  return "vs5bet";
}

export function isTerminalAction(a: ActionMeta) {
  return a.term !== Terminal.None;
}

/** human readable line, e.g. "UTG 2.5 · HJ fold · CO fold" */
export function lineText(m: Manifest, id: number, t: (k: Key) => string): string {
  return history(m, id)
    .map((h) => `${m.players[h.actor]} ${actionLabel(h.action, h.actor, h.before, t)}${h.action.kind >= ActionKind.Raise || (h.action.kind === ActionKind.Call && h.action.to > 1) ? " " + fmtBB(h.action.to) : ""}`)
    .join(" · ");
}

/** the opponent whose action the actor is facing (the last raiser) */
export function aggressorOf(m: Manifest, id: number): number | null {
  return stateAt(m, id).lastRaiser;
}

/** nodes at which `seat` is first to act (used for "RFI" shortcuts) */
export function rfiNode(m: Manifest, seat: number): number | null {
  let id = 0;
  for (let i = 0; i < seat; i++) {
    const n = m.nodes[id];
    const a = n.actions.findIndex((x) => x.kind === ActionKind.Fold);
    if (a < 0 || n.actions[a].child < 0) return null;
    id = n.actions[a].child;
  }
  return m.nodes[id].actor === seat ? id : null;
}
