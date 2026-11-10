/** the ICM screen's inputs, kept in localStorage between visits */
import { int, LocalSchema, pick, str } from "../storage/local";

export const ICM_ACCURACY = ["fast", "std", "high"] as const;
export type IcmAccuracy = (typeof ICM_ACCURACY)[number];

export interface IcmDraft {
  /** players at the table, 2..9 */
  n: number;
  /** stack of each seat in bb, as typed (strings so a half-typed number survives) */
  stacks: string[];
  hero: number;
  ante: string;
  preset: string;
  payoutText: string;
  acc: IcmAccuracy;
}

export const DEFAULT_ICM_DRAFT: IcmDraft = { n: 4, stacks: ["15", "9", "22", "12"], hero: 1, ante: "0", preset: "top3", payoutText: "50, 30, 20", acc: "std" };

/**
 * ICM draft schema history
 *   1: unversioned object (Phase 6–8)
 *   2: `_v`, validated (a stack list of the wrong length is padded / cut to n)
 */
export const ICM_DRAFT_SCHEMA: LocalSchema<IcmDraft> = {
  key: "tessera.icmDraft.v1",
  version: 2,
  migrations: { 1: (d) => d },
  sanitize: (d) => {
    const D = DEFAULT_ICM_DRAFT;
    const n = int(d.n, D.n, 2, 9);
    const given = Array.isArray(d.stacks) ? d.stacks.map((s) => (typeof s === "number" ? String(s) : str(s, "20", 12))) : [];
    const stacks = Array.from({ length: n }, (_, i) => given[i] ?? (n === D.n ? D.stacks[i] : "20"));
    return {
      n,
      stacks,
      hero: int(d.hero, Math.min(D.hero, n - 1), 0, n - 1),
      ante: str(d.ante, D.ante, 12),
      preset: str(d.preset, D.preset, 40),
      payoutText: str(d.payoutText, D.payoutText, 400),
      acc: pick(d.acc, ICM_ACCURACY, D.acc),
    };
  },
};
