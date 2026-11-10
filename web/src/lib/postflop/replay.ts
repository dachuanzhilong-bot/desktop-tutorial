import type { PfEdge, PfFlop, PfNode } from "./decode";

export interface PfStep {
  node: PfNode;
  edgeIndex: number;
  edge: PfEdge;
}

/** nodes from the root to `id` (inclusive) */
export function pathTo(flop: PfFlop, id: number): PfNode[] {
  const out: PfNode[] = [];
  let cur: PfNode | undefined = flop.nodes[id];
  while (cur) {
    out.push(cur);
    cur = cur.parent >= 0 ? flop.nodes[cur.parent] : undefined;
  }
  return out.reverse();
}

export function stepsTo(flop: PfFlop, id: number): PfStep[] {
  const path = pathTo(flop, id);
  const steps: PfStep[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const ei = path[i + 1].parentEdge;
    steps.push({ node: path[i], edgeIndex: ei, edge: path[i].edges[ei] });
  }
  return steps;
}

export interface NodeContext {
  /** board cards dealt so far (card codes) */
  board: number[];
  pot: number;
  /** chips each player has on the current street */
  streetInv: [number, number];
  /** chips the actor must put in to continue */
  toCall: number;
  /** pot before the actor's decision */
  potNow: number;
}

/** board, pot and street bets at a node, reconstructed from the path */
export function contextAt(flop: PfFlop, id: number): NodeContext {
  const path = pathTo(flop, id);
  const board = [...flop.board];
  let streetInv: [number, number] = [0, 0];
  for (let i = 0; i < path.length - 1; i++) {
    const n = path[i];
    const e = n.edges[path[i + 1].parentEdge];
    if (n.type === "chance") {
      board.push(e.kind);
      streetInv = [0, 0];
    } else if (e.kind !== 0) {
      streetInv = n.actor === 0 ? [e.amount, streetInv[1]] : [streetInv[0], e.amount];
    }
  }
  const node = flop.nodes[id];
  const potNow = flop.pot + node.inv[0] + node.inv[1];
  const a = node.type === "decision" ? node.actor : 0;
  const toCall = node.type === "decision" ? Math.max(0, streetInv[1 - a] - streetInv[a]) : 0;
  return { board, pot: potNow, streetInv, toCall, potNow };
}

export interface EdgeLabel {
  /** i18n-free key: fold | check | call | bet | raise | allin */
  key: "fold" | "check" | "call" | "bet" | "raise" | "allin";
  /** chips added by the actor with this action */
  add: number;
  /** add / pot before the action (bets and raises only) */
  pct: number;
}

export function labelEdge(flop: PfFlop, nodeId: number, edgeIndex: number): EdgeLabel {
  const node = flop.nodes[nodeId];
  const e = node.edges[edgeIndex];
  const ctx = contextAt(flop, nodeId);
  const a = node.actor;
  const mine = ctx.streetInv[a];
  const facing = ctx.toCall > 0;
  const add = e.kind === 0 ? 0 : Math.max(0, e.amount - mine);
  if (e.kind === 0) return { key: "fold", add: 0, pct: 0 };
  if (e.kind === 1) return { key: facing ? "call" : "check", add, pct: 0 };
  if (e.kind === 3) return { key: "allin", add, pct: add / ctx.potNow };
  return { key: facing ? "raise" : "bet", add, pct: add / ctx.potNow };
}
