import type { SolutionStore } from "../solution/loader";
import { NUM_CLASSES } from "../poker/hands";
import { ActionKind } from "../solution/types";

export interface RangePreset {
  id: string;
  /** i18n-free title (positions are the same in every language) */
  title: string;
  /** preflop path from the root: F fold, C call, R raise / all-in */
  path: string;
  /** which of the acting player's actions the range consists of */
  kinds: ActionKind[];
}

const RAISE = [ActionKind.Raise, ActionKind.AllIn];

export const RANGE_PRESETS: RangePreset[] = [
  { id: "utg-open", title: "UTG open", path: "", kinds: RAISE },
  { id: "hj-open", title: "HJ open", path: "F", kinds: RAISE },
  { id: "co-open", title: "CO open", path: "FF", kinds: RAISE },
  { id: "btn-open", title: "BTN open", path: "FFF", kinds: RAISE },
  { id: "sb-open", title: "SB open", path: "FFFF", kinds: RAISE },
  { id: "bb-call-btn", title: "BB call vs BTN", path: "FFFRF", kinds: [ActionKind.Call] },
  { id: "bb-3bet-btn", title: "BB 3-bet vs BTN", path: "FFFRF", kinds: RAISE },
  { id: "bb-call-co", title: "BB call vs CO", path: "FFRFF", kinds: [ActionKind.Call] },
  { id: "bb-call-utg", title: "BB call vs UTG", path: "RFFFF", kinds: [ActionKind.Call] },
  { id: "bb-call-sb", title: "BB call vs SB open", path: "FFFFR", kinds: [ActionKind.Call] },
  { id: "btn-call-3bet", title: "BTN call vs BB 3-bet", path: "FFFRFR", kinds: [ActionKind.Call] },
  { id: "btn-4bet", title: "BTN 4-bet vs BB 3-bet", path: "FFFRFR", kinds: RAISE },
];

/** walk "FFFRF" from the root; returns the node id or null when that line is not in the solution */
export function findNode(store: Pick<SolutionStore, "manifest">, path: string): number | null {
  let id = 0;
  for (const ch of path) {
    const n = store.manifest.nodes[id];
    const want = ch === "F" ? [ActionKind.Fold] : ch === "C" ? [ActionKind.Call] : RAISE;
    const a = n.actions.find((x) => want.includes(x.kind));
    if (!a || a.child < 0) return null;
    id = a.child;
  }
  return id;
}

/** the preset range (weight x frequency of the chosen actions) from the preflop solution */
export async function presetRange(store: SolutionStore, p: RangePreset): Promise<Float32Array | null> {
  const id = findNode(store, p.path);
  if (id === null) return null;
  const sol = await store.node(id);
  const meta = store.manifest.nodes[id];
  const idx = meta.actions.map((a, i) => (p.kinds.includes(a.kind) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const out = new Float32Array(NUM_CLASSES);
  for (let h = 0; h < NUM_CLASSES; h++) {
    let f = 0;
    for (const a of idx) f += sol.freq[a * NUM_CLASSES + h];
    out[h] = sol.weight[h] * f;
  }
  return out;
}
