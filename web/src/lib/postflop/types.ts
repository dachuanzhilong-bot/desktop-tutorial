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

/** `PostConfig.hero` of the player out of position / in position */
export const HERO_OOP = 0 as const;
export const HERO_IP = 1 as const;
/** `PostConfig.streets` of a hand played from the flop to the river (flop, turn, river) */
export const ALL_STREETS: readonly number[] = [0, 1, 2];
