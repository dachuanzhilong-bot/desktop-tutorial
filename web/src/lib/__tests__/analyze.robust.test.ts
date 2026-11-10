/**
 * Hand-history import must never crash: every input yields hands or skipped entries with a reason that the UI can
 * translate. Realistic synthetic sessions (PokerStars / GGPoker quirks) and seeded random corruption of them.
 */
import { describe, expect, it } from "vitest";
import { analyzeHand, effectiveStack } from "../analyze/match";
import { normalizeHand } from "../analyze/normalize";
import { parseHandHistory, splitHandBlocks } from "../analyze/parse";
import { reasonText } from "../analyze/reasons";
import { classByName } from "../poker/hands";
import { mulberry32 } from "../util/rng";
import { FILE_CRLF_BOM, H_40BB, H_ALLIN, H_BAD_3BET, H_CO_OPEN, H_GG, H_HEADS_UP, H_ODD_NAMES, H_OMAHA, H_TOURNAMENT, SESSION_GG, SESSION_STARS } from "./fixtures/hands";
import { loadManifest, loadNode } from "./helpers";

const m = loadManifest();
const src = { manifest: m, node: async (id: number) => loadNode(m, id) };
/** a translator that marks translated text, to tell translated reasons from raw English ones */
const tr = (k: string, p?: Record<string, string | number>) => `«${k}${p ? JSON.stringify(p) : ""}»`;

/** the whole pipeline the Analyze screen runs; returns every reason it produced */
async function pipeline(text: string) {
  const reasons: string[] = [];
  const r = parseHandHistory(text);
  reasons.push(...r.skipped.map((s) => s.reason));
  let analysed = 0;
  for (const h of r.hands) {
    const n = normalizeHand(h);
    if ("reason" in n) {
      reasons.push(n.reason);
      continue;
    }
    expect(Number.isFinite(effectiveStack(n))).toBe(true);
    const a = await analyzeHand(src, n);
    if (a.reason) reasons.push(a.reason);
    for (const d of a.decisions) expect(Number.isFinite(d.evLoss) && d.evLoss >= 0).toBe(true);
    analysed++;
  }
  return { r, reasons, analysed };
}

describe("realistic sessions", () => {
  it("PokerStars: ignores chat / joins / disconnects, handles dead blinds and a side pot", async () => {
    const { r, analysed } = await pipeline(SESSION_STARS);
    expect(r.blocks).toBe(2);
    expect(r.hands.map((h) => h.id)).toEqual(["231000000001", "231000000002"]);
    const [h1, h2] = r.hands;
    expect(h1.heroCards).toEqual(["Qs", "Qd"]);
    expect(h1.posts.find((p) => p.kind === "both")).toMatchObject({ player: "NewGuy", amount: 0.75 });
    expect(h1.actions.filter((a) => a.allIn).map((a) => a.player)).toEqual(["Hero", "x Ray x"]);
    expect(h1.shown["kroko_99"]).toEqual(["Kh", "Ks"]);
    expect(h1.collected["kroko_99"]).toBeCloseTo(150.95, 2);
    expect(h1.players.find((p) => p.name === "SlowRoller")?.sittingOut).toBe(true);
    expect(h2.actions.map((a) => `${a.player}:${a.kind}`)).toEqual(["kroko_99:raise", "Mia.L:fold", "NewGuy:fold", "Hero:fold"]);
    expect(analysed).toBe(2);
    const n2 = normalizeHand(h2);
    if ("reason" in n2) throw new Error(n2.reason);
    const a2 = await analyzeHand(src, n2);
    expect(a2.decisions.at(-1)?.handClass).toBe(classByName("72o"));
  });

  it("GGPoker: 'Dealt to' for everyone, Cash Drop and SHOWDOWN lines", async () => {
    const { r, analysed } = await pipeline(SESSION_GG);
    expect(r.hands.map((h) => [h.site, h.id])).toEqual([
      ["ggpoker", "RC2310000003"],
      ["ggpoker", "RC2310000004"],
    ]);
    expect(r.hands[0].hero).toBe("Hero");
    expect(r.hands[0].heroCards).toEqual(["Ac", "Jc"]);
    expect(r.hands[0].board).toEqual(["Jd", "8s", "3c", "2h"]);
    expect(analysed).toBe(2);
  });
});

describe("every reason a hand can be skipped for is translated", () => {
  it("for the known fixtures", async () => {
    const all: string[] = [];
    for (const t of [FILE_CRLF_BOM, H_OMAHA, H_TOURNAMENT, H_HEADS_UP, H_ODD_NAMES, H_40BB, H_GG, H_ALLIN, SESSION_STARS, SESSION_GG]) all.push(...(await pipeline(t)).reasons);
    all.push("file too large", "internal error (boom)", "could not parse (x)", "effective stack 9bb is outside 15-250bb", "raise is not part of the solution at this point");
    for (const reason of all) expect(reasonText(reason, tr), reason).toMatch(/^«analyze\.r\./);
  });
});

describe("fuzz: corrupted files never crash the import", () => {
  const corpus = [H_CO_OPEN, H_BAD_3BET, H_ALLIN, H_HEADS_UP, H_ODD_NAMES, H_40BB, H_GG, SESSION_STARS, SESSION_GG].join("\n\n\n");
  const lines = corpus.split("\n");
  const rnd = mulberry32(20261109);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const junk = () => String.fromCharCode(...Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => Math.floor(rnd() * 0xffff)));
  const mutate = (): string => {
    const ls = lines.slice();
    const n = 1 + Math.floor(rnd() * 8);
    for (let k = 0; k < n && ls.length; k++) {
      const i = Math.floor(rnd() * ls.length);
      switch (Math.floor(rnd() * 8)) {
        case 0: ls.splice(i, 1); break; // drop a line
        case 1: ls.splice(i, 0, pick(lines)); break; // duplicate / misplace a line
        case 2: ls[i] = ls[i].slice(0, Math.floor(rnd() * ls[i].length)); break; // truncate
        case 3: ls[i] = ls[i].replace(/\d/g, () => String(Math.floor(rnd() * 10))); break; // scramble numbers
        case 4: ls[i] = ls[i] + junk(); break; // binary garbage
        case 5: ls[i] = ls[i].replace(/\$[\d.]+/, "$-1"); break; // negative amount
        case 6: ls[i] = ls[i].replace(/\[[^\]]*\]/, "[Zz Yy]"); break; // impossible cards
        default: ls.length = i; // file cut off
      }
    }
    return ls.join(rnd() < 0.5 ? "\n" : "\r\n");
  };

  it("1,500 mutations of real-format files: no exception, every block accounted for", async () => {
    for (let k = 0; k < 1500; k++) {
      const text = mutate();
      const { r } = await pipeline(text);
      expect(r.hands.length + r.skipped.length).toBe(splitHandBlocks(text).length);
      for (const s of r.skipped) expect(typeof s.reason).toBe("string");
    }
  });

  it("garbage and empty inputs", async () => {
    for (const t of ["", " ", "\u0000\u0001\u0002", "PokerStars Hand #", "Poker Hand #X:", "%PDF-1.7\n%âãÏÓ", "PK\u0003\u0004binary zip", "a".repeat(200_000), "PokerStars Hand #1: Hold'em No Limit ($1/$2)\n".repeat(300)]) {
      const { r } = await pipeline(t);
      expect(r.hands.length + r.skipped.length).toBe(r.blocks);
    }
  });
});
