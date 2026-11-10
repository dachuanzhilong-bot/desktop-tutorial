/** wording rules for the UI text, checked so they stay consistent */
import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { ja } from "../i18n/ja";

const keys = Object.keys(ja) as (keyof typeof ja)[];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("UI text", () => {
  it("Japanese and English have the same keys and the same {placeholders}", () => {
    expect(Object.keys(en).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(placeholders(en[k]), k).toEqual(placeholders(ja[k]));
  });

  it("Japanese uses full-width brackets and question marks, and 「」 for quotes", () => {
    for (const k of keys) {
      expect(ja[k], k).not.toMatch(/[()?]/);
      expect(ja[k], k).not.toMatch(/[『』]/);
    }
  });

  it("bet levels are written the same way everywhere (3ベット, not 3bet / 3-bet / スリーベット)", () => {
    for (const k of keys) expect(ja[k], k).not.toMatch(/\d-?bet|スリーベット|フォーベット/i);
  });

  it("no other vendor's product names in the UI", () => {
    const vendors = /GTO\s?Wizard|PioSOLVER|GTO\+|Simple\s?Postflop|MonkerSolver|Hold'em\s?Resources|DTO\s?Poker|PokerSnowie|GTOBase|Odin|Postflop\+/i;
    for (const k of keys) {
      expect(ja[k], k).not.toMatch(vendors);
      expect(en[k], k).not.toMatch(vendors);
    }
  });
});
