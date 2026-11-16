/**
 * Rake in the solution catalog, the manifests and the settings (REFACTOR_PLAN 3-2).
 *
 * The solver names a solution with rake `<id without rake>-r<pct>[c<cap>]` (solver/src/rake.rs `id_suffix`, tested
 * there) and writes `"rake":{"pct":..,"cap":..}` into its manifest; pack-solutions.mjs copies it into index.json.
 * Solutions made before rake existed have neither: they read as "no rake", under their old ids.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA } from "../settings";
import { upgrade } from "../storage/local";
import { DEPTHS, depthOf, IndexEntry, makeCatalog, rakeChoices, rakeOf, rakeOptions, solutionEntry, solutionId, solutionIdWithRake, SOLUTIONS } from "../solution/catalog";
import { parseManifest, RawManifest } from "../solution/decode";
import { NO_RAKE, NO_RAKE_KEY, rakeKey, readRake } from "../solution/rake";

const PUBLIC = path.resolve(__dirname, "../../../public");

describe("the rake field (manifest.rake, index.json solutions[].rake)", () => {
  it("is read as written by the solver; missing or invalid is no rake", () => {
    expect(readRake({ pct: 5, cap: 3 })).toEqual({ pct: 5, cap: 3 });
    expect(readRake({ pct: 4.5, cap: null })).toEqual({ pct: 4.5, cap: null });
    expect(readRake({ pct: 5 })).toEqual({ pct: 5, cap: null });
    for (const bad of [undefined, null, 5, "5", {}, { pct: 0, cap: 3 }, { pct: -1, cap: 3 }, { pct: 100, cap: 3 }, { pct: 5, cap: -1 }, { pct: 5, cap: "3" }])
      expect(readRake(bad), JSON.stringify(bad)).toEqual(NO_RAKE);
  });

  it("has a short key per rake for the settings", () => {
    expect(rakeKey(NO_RAKE)).toBe("0");
    expect(NO_RAKE_KEY).toBe("0");
    expect(rakeKey({ pct: 5, cap: 3 })).toBe("5/3");
    expect(rakeKey({ pct: 5, cap: null })).toBe("5/-");
  });

  it("an old manifest (no rake field) parses as no rake; a manifest with rake keeps it", () => {
    const raw = JSON.parse(gunzipSync(readFileSync(path.join(PUBLIC, "solutions", "cash6max-100bb", "manifest.json.gz"))).toString("utf8")) as RawManifest;
    expect("rake" in raw, "the shipped manifests were made before rake existed").toBe(false);
    expect(parseManifest(raw).rake).toEqual(NO_RAKE);
    const raked = parseManifest({ ...raw, id: "cash6max-100bb-r5c3", rake: { pct: 5, cap: 3 } });
    expect(raked.rake).toEqual({ pct: 5, cap: 3 });
    expect(raked.nodes.length).toBe(raw.nodes.length);
  });
});

describe("the shipped catalog: every solution is without rake, under its old id", () => {
  it("reads the entries made before rake existed as no rake", () => {
    const index: { solutions: Record<string, unknown>[] } = JSON.parse(readFileSync(path.join(PUBLIC, "solutions", "index.json"), "utf8"));
    for (const s of index.solutions) expect("rake" in s, String(s.id)).toBe(false);
    for (const s of SOLUTIONS) {
      expect(s.rake).toEqual(NO_RAKE);
      expect(s.id).toBe(`cash6max-${s.stack}bb`);
      expect(rakeOf(s.id)).toBe(NO_RAKE_KEY);
    }
    expect(solutionEntry("cash6max-100bb")?.rake).toEqual(NO_RAKE);
    expect(depthOf("cash6max-100bb")).toBe(100);
  });

  it("offers no rake choice: the picker is not shown at any depth", () => {
    for (const d of DEPTHS) {
      expect(rakeOptions(d)).toEqual([NO_RAKE]);
      expect(rakeChoices(d)).toEqual([]);
    }
  });

  it("a rake setting the data does not have falls back to the solution without rake", () => {
    for (const d of DEPTHS) {
      expect(solutionIdWithRake(d, "5/3")).toBe(solutionId(d));
      expect(solutionIdWithRake(d, NO_RAKE_KEY)).toBe(solutionId(d));
    }
  });
});

describe("a catalog with solutions of two or more rakes (as 3-3-7 may ship)", () => {
  const e = (id: string, stack: number, rake?: unknown, players = 6): IndexEntry => ({ id, game: "cash", players, stack, build: "b", files: [], ...(rake === undefined ? {} : { rake }) });
  const c = makeCatalog([
    e("cash6max-100bb-r5", 100, { pct: 5, cap: null }),
    e("cash6max-100bb-r5c3", 100, { pct: 5, cap: 3 }),
    e("cash6max-100bb", 100),
    e("cash6max-40bb", 40),
    e("cash2max-100bb-r5c3", 100, { pct: 5, cap: 3 }, 2),
    e("cash6max-20bb-r5c3", 20, { pct: 5, cap: 3 }),
  ]);

  it("lists each depth once, and the rakes of a depth without rake first", () => {
    expect(c.depths).toEqual([20, 40, 100]);
    expect(c.rakeOptions(100)).toEqual([NO_RAKE, { pct: 5, cap: 3 }, { pct: 5, cap: null }]);
    expect(c.solutions.filter((s) => s.stack === 100 && s.players === 6).map((s) => s.id)).toEqual(["cash6max-100bb", "cash6max-100bb-r5c3", "cash6max-100bb-r5"]);
  });

  it("shows the picker only where a depth has two or more rakes (for the same table)", () => {
    expect(c.rakeChoices(100).map(rakeKey)).toEqual(["0", "5/3", "5/-"]);
    expect(c.rakeChoices(40)).toEqual([]);
    expect(c.rakeChoices(20)).toEqual([]);
  });

  it("picks the solution of a depth and a rake; without that rake there, the one without rake", () => {
    expect(c.solutionId(100)).toBe("cash6max-100bb");
    expect(c.solutionId(100, "0")).toBe("cash6max-100bb");
    expect(c.solutionId(100, "5/3")).toBe("cash6max-100bb-r5c3");
    expect(c.solutionId(100, "5/-")).toBe("cash6max-100bb-r5");
    expect(c.solutionId(40, "5/3")).toBe("cash6max-40bb");
    // a depth that is not shipped: the nearest one's, with the rake
    expect(c.solutionId(80, "5/3")).toBe("cash6max-100bb-r5c3");
    // a depth with rake only: its lowest rake
    expect(c.solutionId(20)).toBe("cash6max-20bb-r5c3");
    // the old id keeps its meaning next to the new ones
    expect(c.entry("cash6max-100bb")?.rake).toEqual(NO_RAKE);
    expect(c.entry("cash6max-100bb-r5c3")?.rake).toEqual({ pct: 5, cap: 3 });
  });
});

describe("the rake setting (Settings.rake, added without a schema version)", () => {
  it("settings stored before it existed read as no rake", () => {
    const old = { _v: 3, lang: "en", depth: 40 };
    expect(upgrade(SETTINGS_SCHEMA, old)).toEqual({ ...DEFAULT_SETTINGS, lang: "en", depth: 40, rake: NO_RAKE_KEY });
    expect(DEFAULT_SETTINGS.rake).toBe(NO_RAKE_KEY);
  });

  it("keeps a stored rake; a wrong type is no rake", () => {
    expect(upgrade(SETTINGS_SCHEMA, { _v: 3, rake: "5/3" })?.rake).toBe("5/3");
    expect(upgrade(SETTINGS_SCHEMA, { _v: 3, rake: 5 })?.rake).toBe(NO_RAKE_KEY);
  });
});
