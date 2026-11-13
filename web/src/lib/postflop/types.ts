/** The settings of a post-flop drill (moved from components/postflop/PostSession.tsx, REFACTOR_PLAN 2-3). */
export interface PostConfig {
  kind: "spot" | "through";
  scenario: string;
  /** 0 = out of position, 1 = in position, null = random */
  hero: 0 | 1 | null;
  streets: number[];
  rng: boolean;
  timer: number;
  /** restrict to one flop (index), or null for random */
  flop: number | null;
  /** continue a preflop hand: the hero's 169-chart class */
  heroClass?: number;
}
