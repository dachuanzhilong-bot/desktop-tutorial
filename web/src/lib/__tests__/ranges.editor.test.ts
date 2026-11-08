import { describe, expect, it } from "vitest";
import { classByName } from "../poker/hands";
import { editorReducer, EditorState, initEditor, MAX_HISTORY } from "../ranges/editor";
import { parseRange, rangeCombos } from "../ranges/range";

const id = (n: string) => classByName(n);
const run = (s: EditorState, ...actions: Parameters<typeof editorReducer>[1][]) => actions.reduce(editorReducer, s);
const drag = (s: EditorState, cells: string[], brush = 1, erase = false) =>
  run(s, ...cells.map((c, i) => ({ type: "paint" as const, cls: id(c), phase: i === 0 ? ("start" as const) : ("move" as const), brush, erase })), { type: "strokeEnd" });

describe("Range Builder editor (undo / redo)", () => {
  it("a whole drag is one undo step", () => {
    const s = drag(initEditor(), ["AA", "KK", "QQ"]);
    expect(rangeCombos(s.present)).toBe(18);
    expect(s.past).toHaveLength(1);
    expect(s.text).toBe("QQ+");
    const u = run(s, { type: "undo" });
    expect(rangeCombos(u.present)).toBe(0);
    expect(u.text).toBe("");
    const r = run(u, { type: "redo" });
    expect(rangeCombos(r.present)).toBe(18);
    expect(r.text).toBe("QQ+");
  });

  it("tapping a cell that already has the brush value clears it; erase always clears", () => {
    let s = drag(initEditor(), ["AKs"], 0.5);
    expect(s.present[id("AKs")]).toBeCloseTo(0.5);
    s = drag(s, ["AKs"], 0.5);
    expect(s.present[id("AKs")]).toBe(0);
    s = drag(s, ["AKs", "AQs"], 1);
    s = drag(s, ["AKs"], 1, true);
    expect(s.present[id("AKs")]).toBe(0);
    expect(s.present[id("AQs")]).toBe(1);
    expect(s.past).toHaveLength(4);
  });

  it("a new edit after undo drops the redo branch", () => {
    let s = drag(initEditor(), ["AA"]);
    s = drag(s, ["KK"]);
    s = run(s, { type: "undo" });
    expect(s.future).toHaveLength(1);
    s = drag(s, ["QQ"]);
    expect(s.future).toHaveLength(0);
    expect(run(s, { type: "redo" })).toBe(s);
    expect(s.text).toBe("AA,QQ");
  });

  it("a drag that changes nothing and a no-op set add no history", () => {
    let s = drag(initEditor(), ["AA"], 1, true);
    expect(s.past).toHaveLength(0);
    s = run(s, { type: "set", range: Float32Array.from(s.present) });
    expect(s.past).toHaveLength(0);
  });

  it("text import is undoable and keeps the typed text when there are errors", () => {
    let s = run(initEditor(), { type: "text", text: "AA,KK:0.5" }, { type: "import" });
    expect(rangeCombos(s.present)).toBe(9);
    expect(s.textErr).toEqual([]);
    s = run(s, { type: "text", text: "AA,ZZ" }, { type: "import" });
    expect(s.textErr).toEqual(["ZZ"]);
    expect(s.text).toBe("AA,ZZ");
    expect(rangeCombos(s.present)).toBe(6);
    s = run(s, { type: "undo" });
    expect(rangeCombos(s.present)).toBe(9);
    expect(s.textErr).toEqual([]);
  });

  it("undo is ignored in the middle of a drag, and the history is capped", () => {
    let s = drag(initEditor(), ["AA"]);
    s = run(s, { type: "paint", cls: id("KK"), phase: "start", brush: 1, erase: false });
    expect(run(s, { type: "undo" })).toBe(s);
    s = run(s, { type: "strokeEnd" });
    for (let i = 0; i < MAX_HISTORY + 20; i++) s = run(s, { type: "set", range: parseRange(i % 2 ? "AA" : "KK").range });
    expect(s.past).toHaveLength(MAX_HISTORY);
  });
});
