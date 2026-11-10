/**
 * State of the Range Builder editor as a pure reducer: the range, its text form and an undo/redo history.
 * A drag across many cells is a single "stroke" and therefore a single undo step.
 */
import { emptyRange, formatRange, parseRange } from "./range";

export const MAX_HISTORY = 100;

export interface EditorState {
  past: Float32Array[];
  present: Float32Array;
  future: Float32Array[];
  /** the range before the current drag started (null when not dragging) */
  stroke: Float32Array | null;
  /** value the current drag writes into every cell it touches */
  drag: number;
  /** contents of the text box (may differ from `present` while the user is typing) */
  text: string;
  textErr: string[];
}

export type EditorAction =
  | { type: "set"; range: Float32Array }
  | { type: "paint"; cls: number; phase: "start" | "move"; brush: number; erase: boolean }
  | { type: "strokeEnd" }
  | { type: "text"; text: string }
  | { type: "import" }
  | { type: "undo" }
  | { type: "redo" };

export function initEditor(range: Float32Array = emptyRange()): EditorState {
  return { past: [], present: range, future: [], stroke: null, drag: 0, text: formatRange(range), textErr: [] };
}

const same = (a: Float32Array, b: Float32Array) => {
  if (a === b) return true;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.0005) return false;
  return true;
};

/** make `next` the current range, remembering the previous one for undo */
function commit(s: EditorState, prev: Float32Array, next: Float32Array): EditorState {
  if (same(prev, next)) return { ...s, present: next, stroke: null };
  return { ...s, past: [...s.past, prev].slice(-MAX_HISTORY), present: next, future: [], stroke: null, text: formatRange(next), textErr: [] };
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "set":
      return commit(s, s.present, a.range);
    case "paint": {
      let { stroke, drag } = s;
      if (a.phase === "start") {
        stroke = s.present;
        // tapping a cell that already has the brush value clears it
        drag = a.erase ? 0 : Math.abs(s.present[a.cls] - a.brush) < 0.001 ? 0 : a.brush;
      }
      if (Math.abs(s.present[a.cls] - drag) < 0.0005) return stroke === s.stroke && drag === s.drag ? s : { ...s, stroke, drag };
      const next = Float32Array.from(s.present);
      next[a.cls] = drag;
      return { ...s, present: next, stroke: stroke ?? s.present, drag };
    }
    case "strokeEnd":
      return s.stroke ? commit(s, s.stroke, s.present) : s;
    case "text":
      return { ...s, text: a.text };
    case "import": {
      const r = parseRange(s.text);
      const next = commit(s, s.present, r.range);
      return r.errors.length ? { ...next, text: s.text, textErr: r.errors } : next;
    }
    case "undo": {
      if (!s.past.length || s.stroke) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, past: s.past.slice(0, -1), present: prev, future: [s.present, ...s.future], text: formatRange(prev), textErr: [] };
    }
    case "redo": {
      if (!s.future.length || s.stroke) return s;
      const [next, ...rest] = s.future;
      return { ...s, past: [...s.past, s.present], present: next, future: rest, text: formatRange(next), textErr: [] };
    }
  }
}
