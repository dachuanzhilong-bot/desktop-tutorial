import type { PracticeFilter } from "@/lib/practice/sampler";

export interface PracticeConfig {
  mode: "spot" | "hand";
  filter: PracticeFilter;
  rng: boolean;
  /** seconds per decision, 0 = off */
  timer: number;
}

import type { PostConfig } from "@/components/postflop/PostSession";

/** what the setup screen hands over to the practice page */
export type StartConfig = { type: "pre"; config: PracticeConfig } | { type: "post"; config: PostConfig };
