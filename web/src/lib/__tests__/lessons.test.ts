import { describe, expect, it } from "vitest";
import { LESSONS, lessonById, nextLesson } from "../learn/lessons";
import { LESSONS_KEY, mergeLessonsDone, readLessonsDone, sanitizeLessonsDone, setLessonDone } from "../storage/lessons";
import { MemoryRepo } from "../storage/memory";
import { SPOT_TYPES } from "../solution/types";

const texts = LESSONS.flatMap((l) => [l.ja, l.en]);

describe("learning path content", () => {
  it("has unique ids, a sensible length, and both languages written out", () => {
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    expect(LESSONS.length).toBeGreaterThanOrEqual(8);
    for (const l of LESSONS) {
      expect(l.id, l.id).toMatch(/^[a-z0-9]+$/);
      expect(l.minutes).toBeGreaterThan(0);
      expect(l.minutes).toBeLessThanOrEqual(8);
      for (const t of [l.ja, l.en]) {
        expect(t.title.length, `${l.id} title`).toBeGreaterThan(2);
        expect(t.lead.length, `${l.id} lead`).toBeGreaterThan(10);
        expect(t.points.length, `${l.id} points`).toBeGreaterThanOrEqual(3);
        expect(t.points.length).toBeLessThanOrEqual(6);
        expect(t.why.length).toBeGreaterThan(20);
        for (const p of t.points) expect(p.length, `${l.id}: ${p}`).toBeGreaterThan(15);
      }
      // the two languages say the same number of things
      expect(l.en.points.length, l.id).toBe(l.ja.points.length);
      expect(l.tries.length, l.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("sends the reader to screens that exist, with presets the Practice screen understands", () => {
    const routes = new Set(["/study/", "/study/postflop/", "/study/report/", "/practice/", "/odds/", "/equity/", "/builder/", "/icm/", "/analyze/", "/stats/"]);
    for (const l of LESSONS)
      for (const x of l.tries) {
        const [path, hash = ""] = x.href.split("#");
        expect(routes.has(path), `${l.id}: ${x.href}`).toBe(true);
        expect(x.ja.length).toBeGreaterThan(3);
        expect(x.en.length).toBeGreaterThan(3);
        if (path === "/practice/" && hash) {
          const p = new URLSearchParams(hash);
          if (p.get("spot")) expect(SPOT_TYPES as string[], `${l.id}: spot`).toContain(p.get("spot"));
          if (p.get("seat")) expect(p.get("seat")).toMatch(/^[0-5]$/);
          if (p.get("mode")) expect(["spot", "hand", "postSpot", "post"]).toContain(p.get("mode"));
        }
      }
  });

  it("follows the notation rules of the Japanese text (3ベット, not 3bet) and names no other product", () => {
    for (const t of texts) {
      const all = [t.title, t.lead, t.why, ...t.points].join("\n");
      if (t === LESSONS.find((l) => l.ja === t)?.ja) expect(all).not.toMatch(/\d-?bet|スリーベット|フォーベット/i);
      expect(all).not.toMatch(/GTO\s?Wizard|PioSOLVER|GTO\+|Simple\s?Postflop|MonkerSolver|Hold'em\s?Resources|DTO\s?Poker|PokerSnowie|GTOBase|Odin|Postflop\+/i);
    }
  });

  it("finds a lesson by id and the next one that is not done", () => {
    expect(lessonById("potodds")?.id).toBe("potodds");
    expect(lessonById("nope")).toBeUndefined();
    expect(nextLesson(new Set())?.id).toBe(LESSONS[0].id);
    expect(nextLesson(new Set([LESSONS[0].id]))?.id).toBe(LESSONS[1].id);
    expect(nextLesson(new Set(LESSONS.map((l) => l.id)))).toBeNull();
  });
});

describe("lesson progress", () => {
  it("keeps known lessons only, once each, earliest first", () => {
    const a = LESSONS[0].id;
    const b = LESSONS[1].id;
    expect(
      sanitizeLessonsDone([{ id: b, ts: 9 }, { id: a, ts: 5 }, { id: a, ts: 2 }, { id: "nope", ts: 1 }, { id: a, ts: Number.NaN }, null, "x"]),
    ).toEqual([{ id: a, ts: 2 }, { id: b, ts: 9 }]);
    expect(sanitizeLessonsDone(undefined)).toEqual([]);
  });

  it("marks and unmarks, also when the taps come at once", async () => {
    const repo = new MemoryRepo();
    const [a, b, c] = LESSONS.map((l) => l.id);
    await Promise.all([setLessonDone(repo, a, true, 1), setLessonDone(repo, b, true, 2), setLessonDone(repo, c, true, 3)]);
    expect((await readLessonsDone(repo)).map((x) => x.id)).toEqual([a, b, c]);
    await setLessonDone(repo, b, false);
    expect((await readLessonsDone(repo)).map((x) => x.id)).toEqual([a, c]);
    await setLessonDone(repo, "nope", true);
    expect((await readLessonsDone(repo)).map((x) => x.id)).toEqual([a, c]);
  });

  it("travels in the backup and is merged on import", async () => {
    const [a, b] = LESSONS.map((l) => l.id);
    const x = new MemoryRepo();
    await setLessonDone(x, a, true, 10);
    const blob = JSON.parse(JSON.stringify(await x.exportAll()));
    expect(blob.meta[LESSONS_KEY]).toHaveLength(1);
    const y = new MemoryRepo();
    await setLessonDone(y, b, true, 20);
    await y.importAll(blob);
    await y.importAll(blob);
    expect((await readLessonsDone(y)).map((e) => e.id)).toEqual([a, b]);
    expect(mergeLessonsDone([{ id: a, ts: 5 }], [{ id: a, ts: 3 }])).toEqual([{ id: a, ts: 3 }]);
  });
});
