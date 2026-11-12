/**
 * Stable position keys for postflop solutions (REFACTOR_PLAN step 1-2, docs/03 "局面キー").
 *
 * Nothing in a key depends on numbers that change when the data is generated again
 * (node ids, the flop's index in index.json, file names).
 *
 * Flop: `flopKey(board)` = the three cards without spaces, sorted by rank (high first) and,
 * for equal ranks, by suit s > h > d > c. "As 7d 2c" -> "As7d2c", "8c 8d 3s" -> "8d8c3s".
 * The same flop gives the same string whatever order its cards are listed in.
 *
 * Node (unique inside one flop of one scenario): the actions and cards from the flop root.
 *   F          fold
 *   X          check
 *   C          call
 *   B<amount>  bet (nothing to call)
 *   R<amount>  raise (facing a bet)
 *   A<amount>  all-in
 *   <card>     turn / river card, e.g. "Td" (rank 2-9 T J Q K A, suit c d h s)
 * <amount> is the actor's total chips on the current street after the action, in bb,
 * rounded to 0.01 and written without trailing zeros (the same rule as the preflop key).
 * Actions of one street are joined by "-"; a card is separated from its neighbours by "/".
 * The flop root (no action yet) is "root", so a key is never the empty string.
 *
 * Examples: "root", "X-B1.75-C" (the turn is about to be dealt), "X-B1.75-C/Td" (first decision
 * on the Td turn), "X-B1.75-C/Td/X-X/2c/B4.25", "X-X/Ah/X-X/Jc/X-B2.75".
 *
 * The shipped trees hold only a sample of turn and river cards and leave out rare lines:
 * a key whose card or line is not in the tree resolves to null.
 */
import { keyAmount, ROOT_KEY } from "../solution/positionKey";
import { cardText } from "./combos";
import type { PfEdge, PfFlop, PfNode } from "./decode";
import { stepsTo } from "./replay";

export { ROOT_KEY };

/** board string of a flop, independent of the order of its cards (see the file comment) */
export function flopKey(board: readonly number[]): string {
  return [...board]
    .sort((a, b) => b - a)
    .map(cardText)
    .join("");
}

/** token of one edge of `node`; `streetInv` = chips of [oop, ip] on this street before the action */
function edgeToken(node: PfNode, e: PfEdge, streetInv: readonly [number, number]): string {
  if (node.type === "chance") return cardText(e.kind);
  const facing = streetInv[1 - node.actor] > streetInv[node.actor];
  if (e.kind === 0) return "F";
  if (e.kind === 1) return facing ? "C" : "X";
  if (e.kind === 3) return `A${keyAmount(e.amount)}`;
  return `${facing ? "R" : "B"}${keyAmount(e.amount)}`;
}

/** street bets after taking edge `e` at `node` */
function nextStreetInv(node: PfNode, e: PfEdge, streetInv: readonly [number, number]): [number, number] {
  if (node.type === "chance") return [0, 0];
  if (e.kind === 0) return [streetInv[0], streetInv[1]];
  return node.actor === 0 ? [e.amount, streetInv[1]] : [streetInv[0], e.amount];
}

/** key of node `nodeId` (decision or chance node) inside its flop */
export function postflopKey(flop: PfFlop, nodeId: number): string {
  const steps = stepsTo(flop, nodeId);
  if (steps.length === 0) return ROOT_KEY;
  let out = "";
  let streetInv: [number, number] = [0, 0];
  let prevCard = false;
  steps.forEach((s, i) => {
    const card = s.node.type === "chance";
    if (i > 0) out += card || prevCard ? "/" : "-";
    out += edgeToken(s.node, s.edge, streetInv);
    streetInv = nextStreetInv(s.node, s.edge, streetInv);
    prevCard = card;
  });
  return out;
}

/** current node id of a key in `flop`, or null if the tree has no such node (never throws) */
export function resolvePostflopKey(flop: PfFlop, key: string): number | null {
  if (typeof key !== "string" || key === "" || !flop.nodes.length) return null;
  if (key === ROOT_KEY) return 0;
  let id = 0;
  let streetInv: [number, number] = [0, 0];
  for (const token of key.split(/[-/]/)) {
    const node = flop.nodes[id];
    if (!node) return null;
    const inv = streetInv;
    const edge = node.edges.find((e) => edgeToken(node, e, inv) === token);
    if (!edge || edge.code < 0) return null;
    streetInv = nextStreetInv(node, edge, streetInv);
    id = edge.code;
  }
  // the separators must be the canonical ones too ("X/X" or "X-Td" are not keys)
  return flop.nodes[id] && postflopKey(flop, id) === key ? id : null;
}
