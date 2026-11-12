import type { ReviewItem } from "@/lib/practice/review";
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
  /** solution id the questions belong to */
  solution: string;
  /** each question names its decision by a position key; the node is looked up when the set starts (lib/practice/review.ts: resolveItems) */
  items: ReviewItem[];
}

import type { PostConfig } from "@/components/postflop/PostSession";

/** what the setup screen hands over to the practice page */
export type StartConfig = { type: "pre"; config: PracticeConfig } | { type: "post"; config: PostConfig };
