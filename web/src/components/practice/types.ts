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

import type { PostConfig } from "@/components/postflop/PostSession";

/** what the setup screen hands over to the practice page */
export type StartConfig = { type: "pre"; config: PracticeConfig } | { type: "post"; config: PostConfig };
