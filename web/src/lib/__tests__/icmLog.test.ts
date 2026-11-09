import { describe, expect, it } from "vitest";
import { appendIcmLog, ICM_LOG_KEY, ICM_LOG_MAX, mergeIcmLog, readIcmLog, sanitizeIcmLog, summarizeIcm } from "../storage/icmLog";
import type { IcmLogEntry } from "../storage/icmLog";
import { MemoryRepo } from "../storage/memory";

const entry = (over: Partial<IcmLogEntry> = {}): IcmLogEntry => ({
  ts: 1_700_000_000_000,
  players: 3,
  pos: "BTN",
  stack: 12,
  facing: null,
  hand: 0,
  chosen: 1,
  grade: "best",
  evLoss: 0,
  score: 100,
  ...over,
});

describe("ICM drill log", () => {
  it("keeps only well-formed entries", () => {
    const good = entry();
    const bad = [null, 1, "x", { ...good, hand: 169 }, { ...good, hand: 1.5 }, { ...good, chosen: 2 }, { ...good, grade: "great" }, { ...good, evLoss: Number.NaN }, { ...good, facing: 3 }];
    expect(sanitizeIcmLog([good, ...bad])).toEqual([good]);
    expect(sanitizeIcmLog({ not: "a list" })).toEqual([]);
    expect(sanitizeIcmLog(undefined)).toEqual([]);
  });

  it("merges two logs without duplicates, oldest first, and keeps the newest entries", () => {
    const a = [entry({ ts: 3 }), entry({ ts: 1 })];
    const b = [entry({ ts: 1 }), entry({ ts: 2, hand: 5 })];
    expect(mergeIcmLog(a, b).map((e) => e.ts)).toEqual([1, 2, 3]);
    const many = Array.from({ length: ICM_LOG_MAX + 10 }, (_, i) => entry({ ts: i }));
    const kept = mergeIcmLog(many, []);
    expect(kept).toHaveLength(ICM_LOG_MAX);
    expect(kept[0].ts).toBe(10);
  });

  it("summarizes accuracy and loss, costliest spot first", () => {
    const s = summarizeIcm([
      entry({ pos: "BTN", grade: "best", evLoss: 0 }),
      entry({ pos: "BTN", grade: "mistake", evLoss: 0.4 }),
      entry({ pos: "BB", facing: "BTN", grade: "blunder", evLoss: 1.2 }),
    ]);
    expect(s.n).toBe(3);
    expect(s.accuracy).toBeCloseTo(1 / 3);
    expect(s.avgLoss).toBeCloseTo(1.6 / 3);
    expect(s.byPos.map((r) => r.pos)).toEqual(["BB vs BTN", "BTN"]);
    expect(s.byPos[1]).toMatchObject({ n: 2, accuracy: 0.5 });
    expect(summarizeIcm([])).toMatchObject({ n: 0, accuracy: 0, avgLoss: 0, byPos: [] });
  });

  it("appends answers in order even when they come at once", async () => {
    const repo = new MemoryRepo();
    await Promise.all([1, 2, 3, 4, 5].map((ts) => appendIcmLog(repo, entry({ ts }))));
    expect((await readIcmLog(repo)).map((e) => e.ts)).toEqual([1, 2, 3, 4, 5]);
  });

  it("travels in the backup file and is merged (not replaced) on import", async () => {
    const a = new MemoryRepo();
    await appendIcmLog(a, entry({ ts: 1 }));
    await appendIcmLog(a, entry({ ts: 2 }));
    const blob = await a.exportAll();
    expect(blob.meta[ICM_LOG_KEY]).toHaveLength(2);
    const b = new MemoryRepo();
    await appendIcmLog(b, entry({ ts: 3 }));
    await b.importAll(JSON.parse(JSON.stringify(blob)));
    await b.importAll(JSON.parse(JSON.stringify(blob)));
    expect((await readIcmLog(b)).map((e) => e.ts)).toEqual([1, 2, 3]);
  });
});
