import { describe, expect, it } from "vitest";
import { DEFAULT_ICM_DRAFT, ICM_DRAFT_SCHEMA } from "../icm/draft";
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA } from "../settings";
import { DEFAULT_SOLVE } from "../solve/config";
import { SOLVE_DRAFT_SCHEMA } from "../solve/draft";
import { LocalSchema, readLocal, upgrade, VERSION_FIELD, writeLocal } from "../storage/local";

/** in-memory Storage */
function mem(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

describe("versioned localStorage values", () => {
  const schema: LocalSchema<{ a: number; b: string }> = {
    key: "k",
    version: 3,
    migrations: {
      1: (d) => ({ ...d, a: Number(d.a ?? 0) + 1 }),
      2: (d) => ({ ...d, b: `v2:${d.b ?? ""}` }),
    },
    sanitize: (d) => ({ a: typeof d.a === "number" ? d.a : -1, b: typeof d.b === "string" ? d.b : "" }),
  };

  it("runs every migration step from an unversioned (v1) value", () => {
    expect(upgrade(schema, { a: 1, b: "x" })).toEqual({ a: 2, b: "v2:x" });
  });
  it("starts from the stored version", () => {
    expect(upgrade(schema, { a: 1, b: "x", [VERSION_FIELD]: 2 })).toEqual({ a: 1, b: "v2:x" });
    expect(upgrade(schema, { a: 1, b: "x", [VERSION_FIELD]: 3 })).toEqual({ a: 1, b: "x" });
  });
  it("sanitizes a value written by a newer app version instead of failing", () => {
    expect(upgrade(schema, { a: "oops", b: "x", extra: 1, [VERSION_FIELD]: 9 })).toEqual({ a: -1, b: "x" });
  });
  it("writes the current version and reads it back unchanged", () => {
    const s = mem();
    expect(writeLocal(schema, { a: 5, b: "y" }, s)).toBe(true);
    expect(JSON.parse(s.raw.get("k")!)[VERSION_FIELD]).toBe(3);
    expect(readLocal(schema, s)).toEqual({ a: 5, b: "y" });
  });
  it("treats corrupt JSON, arrays and primitives as nothing stored", () => {
    for (const bad of ["{", "[]", "42", '"str"', "null"]) expect(readLocal(schema, mem({ k: bad }))).toBeNull();
    expect(readLocal(schema, mem())).toBeNull();
  });
  it("survives a storage that throws (private mode / quota)", () => {
    const boom = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(readLocal(schema, boom)).toBeNull();
    expect(writeLocal(schema, { a: 1, b: "" }, boom)).toBe(false);
  });
});

describe("settings schema", () => {
  it("upgrades a Phase 1–8 settings object (no version) keeping the user's choices", () => {
    const v1 = { lang: "en", theme: "light", palette: "cvd", pattern: true, labels: false, deck4: false, textScale: 1.15, haptics: false, dailyGoal: 50, depth: 40, onboarded: true };
    expect(upgrade(SETTINGS_SCHEMA, v1)).toEqual(v1);
  });
  it("fills missing fields with defaults (the e2e tests store only {onboarded:true})", () => {
    expect(upgrade(SETTINGS_SCHEMA, { onboarded: true })).toEqual({ ...DEFAULT_SETTINGS, onboarded: true });
  });
  it("drops invalid values and unknown fields", () => {
    const s = upgrade(SETTINGS_SCHEMA, { lang: "fr", theme: 3, textScale: 99, dailyGoal: 2.5, depth: 70, junk: { x: 1 } })!;
    expect(s.lang).toBe("ja");
    expect(s.theme).toBe("dark");
    expect(s.textScale).toBe(1.3);
    expect(s.dailyGoal).toBe(DEFAULT_SETTINGS.dailyGoal);
    expect(s.depth).toBe(60); // 70bb has no solution: the nearest one (log scale)
    expect("junk" in s).toBe(false);
  });
  it("round-trips through storage with the version field", () => {
    const store = mem();
    writeLocal(SETTINGS_SCHEMA, { ...DEFAULT_SETTINGS, lang: "en" }, store);
    expect(JSON.parse(store.raw.get(SETTINGS_SCHEMA.key)!)[VERSION_FIELD]).toBe(SETTINGS_SCHEMA.version);
    expect(readLocal(SETTINGS_SCHEMA, store)?.lang).toBe("en");
  });
});

describe("Solve draft schema", () => {
  it("keeps a valid old draft", () => {
    const d = upgrade(SOLVE_DRAFT_SCHEMA, { board: [0, 13, 26], oopText: "AA", ipText: "KK", oopName: "BB", ipName: "BTN", pot: 5.5, stack: 97.5, acc: "high", iterations: 600, target: 0.5, cfg: DEFAULT_SOLVE })!;
    expect(d.board).toEqual([0, 13, 26]);
    expect(d.cfg).toEqual(DEFAULT_SOLVE);
    expect(d.acc).toBe("high");
  });
  it("drops a broken board, bad numbers and repairs the solver config", () => {
    const d = upgrade(SOLVE_DRAFT_SCHEMA, { board: [0, 0, 99], pot: -3, stack: "x", acc: "ultra", iterations: 1.5, cfg: { bets: [["half"], [0.66], null], raiseMult: 1000, turnCards: 0 } })!;
    expect(d.board).toBeUndefined();
    expect(d.pot).toBeUndefined();
    expect(d.stack).toBeUndefined();
    expect(d.acc).toBe("std");
    expect(d.iterations).toBeUndefined();
    expect(d.cfg?.bets).toEqual([DEFAULT_SOLVE.bets[0], [0.66], DEFAULT_SOLVE.bets[2]]);
    expect(d.cfg?.raiseMult).toBe(10);
    expect(d.cfg?.turnCards).toBe(1); // clamped to the smallest valid value
  });
});

describe("ICM draft schema", () => {
  it("keeps a valid old draft", () => {
    const v1 = { n: 3, stacks: ["10", "20", "30"], hero: 2, ante: "0.1", preset: "top3", payoutText: "50, 30, 20", acc: "fast" };
    expect(upgrade(ICM_DRAFT_SCHEMA, v1)).toEqual(v1);
  });
  it("repairs a stack list of the wrong length and an out-of-range hero", () => {
    const d = upgrade(ICM_DRAFT_SCHEMA, { n: 5, stacks: [10, "12"], hero: 7 })!;
    expect(d.stacks).toEqual(["10", "12", "20", "20", "20"]);
    expect(d.hero).toBe(4); // clamped to the last seat
    expect(upgrade(ICM_DRAFT_SCHEMA, { n: 40 })!.n).toBe(9);
    expect(upgrade(ICM_DRAFT_SCHEMA, { n: "four" })).toEqual(DEFAULT_ICM_DRAFT);
  });
});
