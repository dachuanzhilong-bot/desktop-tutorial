/**
 * Stable position keys for preflop solutions (REFACTOR_PLAN step 1-2, docs/03 "局面キー").
 *
 * A key names a decision by the actions that lead to it from the root, never by a node id,
 * a chunk number or anything else that changes when the solution is generated again.
 * It is unique inside one solution; the solution itself (stack depth) is identified separately.
 *
 * Format: action tokens joined by "-", in the order they were played (UTG first).
 *   F        fold
 *   X        check (the actor already matches the current bet: the big blind after a limp).
 *            In the shipped trees that check ends the betting, so no key contains it yet.
 *   C        call (including a limp)
 *   R<to>    raise; <to> is the total the raiser has in after the action, in bb
 *   A<to>    all-in; <to> as above
 * Amounts are rounded to 0.01bb and written without trailing zeros ("2.5", "11", "13.25").
 * The root (no action yet) is "root", so a key is never the empty string.
 *
 * Examples (100bb): "root" (UTG to act), "F-F-R2.5-F-F" (big blind facing a CO open),
 * "F-F-F-F-C" (big blind after a small-blind limp), "F-F-F-R2.5-F-R11-R25.5-A100".
 * An action that ends the preflop betting leads to no decision, so "F-F-R2.5-F-F-C" resolves to null.
 */
import { applyAction, history, initialState } from "./tree";
import { ActionKind } from "./types";
import type { ActionMeta, Manifest, PublicState } from "./types";

/** key of the root node (no action taken yet) */
export const ROOT_KEY = "root";

/** amount in bb for a key: rounded to 0.01, no trailing zeros, never exponent notation for chip amounts */
export function keyAmount(x: number): string {
  return String(Math.round(x * 100) / 100);
}

/** token of one action, taken by `actor` in public state `before` */
function actionToken(a: ActionMeta, actor: number, before: PublicState): string {
  switch (a.kind) {
    case ActionKind.Fold:
      return "F";
    case ActionKind.Call:
      return before.inv[actor] >= before.cur ? "X" : "C";
    case ActionKind.AllIn:
      return `A${keyAmount(a.to)}`;
    default:
      return `R${keyAmount(a.to)}`;
  }
}

/** key of node `nodeId`: the actions from the root to it. Throws nothing for ids of the manifest. */
export function preflopKey(m: Manifest, nodeId: number): string {
  const steps = history(m, nodeId);
  if (steps.length === 0) return ROOT_KEY;
  return steps.map((s) => actionToken(s.action, s.actor, s.before)).join("-");
}

/** current node id of a key, or null if this solution has no such decision (never throws) */
export function resolvePreflopKey(m: Manifest, key: string): number | null {
  if (typeof key !== "string" || key === "" || !m.nodes.length) return null;
  if (key === ROOT_KEY) return 0;
  let id = 0;
  let state = initialState(m);
  for (const token of key.split("-")) {
    const node = m.nodes[id];
    if (!node) return null;
    const action = node.actions.find((a) => actionToken(a, node.actor, state) === token);
    if (!action || action.child < 0) return null;
    state = applyAction(state, node.actor, action);
    id = action.child;
  }
  return m.nodes[id] ? id : null;
}
