import type { PracticeFilter } from "@/lib/practice/sampler";

export interface PracticeConfig {
  mode: "spot" | "hand";
  filter: PracticeFilter;
  rng: boolean;
  /** seconds per decision, 0 = off */
  timer: number;
  /** a fixed list of questions (e.g. the mistakes found by Analyze): asked in random order, then again */
  fixed?: { nodeId: number; hand: number }[];
  /** shown in the session header when `fixed` is used */
  title?: string;
}

/** a prepared question list: the mistakes Analyze found, or a round of spaced-repetition reviews */
export interface PracticeSet {
  title: string;
  /** solution id the questions belong to (absent in sets made before stack depths existed: 100bb) */
  solution?: string;
  /** with `pos` (a position key) the node id is looked up again when the set starts (lib/practice/review.ts: resolveItems) */
  items: { nodeId: number; hand: number; pos?: string }[];
}

import type { PostConfig } from "@/components/postflop/PostSession";

/** what the setup screen hands over to the practice page */
export type StartConfig = { type: "pre"; config: PracticeConfig } | { type: "post"; config: PostConfig };
