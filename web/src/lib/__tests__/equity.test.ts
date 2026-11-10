import { describe, expect, it } from "vitest";
import { computeEquity, EquityCalc, EquityError, playerFromHand, playerFromRange, validateBoard } from "../poker/equity";
import type { EquityPlayer } from "../poker/equity";
import { eval7 } from "../poker/eval7";
import { parseBoard, parseCard } from "../postflop/combos";
import { parseRange } from "../ranges/range";
import { mulberry32 } from "../util/rng";

const hand = (s: string) => {
  const [a, b] = s.split(" ").map(parseCard);
  return playerFromHand(a, b);
};
const board = (s: string) => (s ? parseBoard(s) : []);
const exact = async (a: string, b: string, bd = "") => (await computeEquity([hand(a), hand(b)], board(bd)))!;

describe("equity: exact (every player holds one hand)", () => {
  it("matches a plain double loop over the flop's turn and river cards", async () => {
    const [h, v, f] = ["Ah Ad", "Kh Qd", "Ks 7d 2c"];
    const hole = [h, v].map((s) => s.split(" ").map(parseCard));
    const bd = parseBoard(f);
    const used = new Set([...hole.flat(), ...bd]);
    const free = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
    let heroEq = 0;
    let n = 0;
    for (let i = 0; i < free.length; i++)
      for (let j = i + 1; j < free.length; j++) {
        const a = eval7([...hole[0], ...bd, free[i], free[j]]);
        const b = eval7([...hole[1], ...bd, free[i], free[j]]);
        heroEq += a > b ? 1 : a === b ? 0.5 : 0;
        n++;
      }
    const r = await exact(h, v, f);
    expect(r.exact).toBe(true);
    expect(r.boards).toBe(n); // C(45,2) = 990
    expect(r.players[0].equity).toBeCloseTo(heroEq / n, 12);
    expect(r.players[0].equity + r.players[1].equity).toBeCloseTo(1, 12);
    expect(r.players[0].win + r.players[0].tie + r.players[1].win).toBeCloseTo(1, 12);
  });

  it("gives the textbook numbers before the flop", async () => {
    const aaKk = await exact("As Ah", "Ks Kh");
    expect(aaKk.boards).toBe(1_712_304);
    expect(aaKk.players[0].equity).toBeGreaterThan(0.8);
    expect(aaKk.players[0].equity).toBeLessThan(0.84);
    const aa72 = await exact("As Ah", "7d 2c");
    expect(aa72.players[0].equity).toBeGreaterThan(0.86);
    expect(aa72.players[0].equity).toBeLessThan(0.89);
    // mirrored suits make the same hand: a dead even split
    const mirror = await exact("Ah Kd", "As Kc");
    expect(mirror.players[0].equity).toBeCloseTo(0.5, 12);
  }, 60_000);

  it("is certain when the board is complete, and counts one runout card on the turn", async () => {
    const river = await exact("Ah Kh", "Qs Qd", "Ad 7c 2h 9h 3s");
    expect(river.boards).toBe(1);
    expect(river.players[0].equity).toBe(1); // a pair of aces beats a pair of queens
    const turn = await exact("Ah Kh", "Qs Qd", "Ad 7c 2h 9h");
    expect(turn.boards).toBe(44);
  });

  it("splits three ways, and ties share the pot", async () => {
    const r = (await computeEquity([hand("Ah Kd"), hand("As Kc"), hand("Qh Qd")], board("2c 3c 4h 9s Jd")))!;
    // the queens' pair beats the two identical ace-high hands, which split nothing
    expect(r.players.map((p) => p.equity)).toEqual([0, 0, 1]);
    const tie = (await computeEquity([hand("Ah Kd"), hand("As Kc")], board("2c 3c 4h 9s Jd")))!;
    expect(tie.players[0]).toMatchObject({ equity: 0.5, win: 0, tie: 1 });
  });
});

describe("equity: sampled (a range is involved)", () => {
  const sampled = (players: EquityPlayer[], bd = "", samples = 100_000) => computeEquity(players, board(bd), { samples, rnd: mulberry32(11) });
  const range = (t: string) => playerFromRange(parseRange(t).range);

  it("lands within a few standard errors of the known numbers and says how sure it is", async () => {
    const r = (await sampled([range("AA"), range("KK")]))!;
    expect(r.exact).toBe(false);
    expect(r.boards).toBe(100_000);
    expect(r.players[0].stdErr).toBeGreaterThan(0);
    expect(r.players[0].stdErr).toBeLessThan(0.003);
    expect(Math.abs(r.players[0].equity - 0.819)).toBeLessThan(0.012);
    expect(r.players[0].equity + r.players[1].equity).toBeCloseTo(1, 9);
  });

  it("two identical ranges are even", async () => {
    const r = (await sampled([range("22+,A2s+,K9s+,QTs+,AJo+,KQo"), range("22+,A2s+,K9s+,QTs+,AJo+,KQo")]))!;
    for (const p of r.players) expect(Math.abs(p.equity - 0.5)).toBeLessThan(4 * p.stdErr + 1e-9);
  });

  it("follows the weights of a range", async () => {
    const villain: EquityPlayer = { c1: [parseCard("Kh"), parseCard("Qh")], c2: [parseCard("Kd"), parseCard("Qd")], w: [3, 1] };
    const hero = hand("As Ac");
    const bd = "9c 5d 2s";
    const kk = (await exact("As Ac", "Kh Kd", bd)).players[0].equity;
    const qq = (await exact("As Ac", "Qh Qd", bd)).players[0].equity;
    const r = (await sampled([hero, villain], bd, 60_000))!;
    expect(Math.abs(r.players[0].equity - (0.75 * kk + 0.25 * qq))).toBeLessThan(4 * r.players[0].stdErr + 1e-6);
  });

  it("says so when the ranges cannot be dealt together", async () => {
    // one ace is on the board: three are left, and two hands of AA need four
    await expect(sampled([range("AA"), range("AA")], "Ac 7h 2d", 1_000)).rejects.toMatchObject({ problem: "impossible" });
  });

  it("is uniform over the cards left: an ace-high board gives the ace of the unused suits its fair share", async () => {
    // a hand with no ace against a hand with no ace: the aces on the turn and river hit both the same, so the
    // equity stays what the exact count says (this caught a draw that favoured the cards next to the used ones)
    const exactEq = (await exact("Kd Kc", "Qd Qc")).players[0].equity;
    const r = (await sampled([hand("Kd Kc"), range("QQ")], "", 100_000))!;
    expect(Math.abs(r.players[0].equity - exactEq)).toBeLessThan(0.02); // the QQ range also holds QhQs, QdQh ...: close, not equal
  });
});

describe("equity: bad input", () => {
  it("rejects boards of the wrong size and repeated cards", async () => {
    expect(validateBoard(board("Ah"))).toBe("boardSize");
    expect(validateBoard(board("Ah Kh"))).toBe("boardSize");
    expect(validateBoard(board("Ah Kh Qh Jh Th 2c"))).toBe("boardSize");
    expect(validateBoard(board("Ah Ah Qh"))).toBe("duplicateCard");
    expect(validateBoard(board("Ah Kh Qh"))).toBeNull();
    expect(() => new EquityCalc([hand("Ah Kd"), hand("2c 3c")], board("Ah Kh Qh"), 1)).toThrowError(EquityError);
  });

  it("rejects two players holding the same card, and ranges that cannot be dealt", () => {
    expect(() => new EquityCalc([hand("Ah Kd"), hand("Ah Qc")], [], 1)).toThrowError(expect.objectContaining({ problem: "duplicateCard" }));
    // three aces are on the board: no combo of AA is left
    const aa = playerFromRange(parseRange("AA").range);
    expect(() => new EquityCalc([hand("2c 3c"), aa], board("Ah Ad Ac"), 1)).toThrowError(expect.objectContaining({ problem: "noCombos" }));
  });

  it("can be aborted and reports progress", async () => {
    const ctl = new AbortController();
    const seen: number[] = [];
    const r = await computeEquity([playerFromRange(parseRange("AA").range), playerFromRange(parseRange("KK").range)], [], {
      samples: 100_000,
      slice: 10_000,
      rnd: mulberry32(1),
      signal: ctl.signal,
      yieldNow: async () => {
        if (seen.length === 3) ctl.abort();
      },
      onProgress: (f) => seen.push(f),
    });
    expect(r).toBeNull();
    expect(seen).toEqual([0.1, 0.2, 0.3]);
  });
});
