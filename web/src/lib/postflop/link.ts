import { BB_SEAT, SEATS } from "../solution/tree";
import type { PublicState } from "../solution/types";
import type { PostConfig } from "./types";

/**
 * When a preflop hand ends with a heads-up flop that the postflop solutions cover, returns the
 * config that continues the same hand on the flop (same seat, same hand class).
 */
export function postflopLink(state: PublicState, heroSeat: number, heroClass: number, available: string[], rng: boolean, timer: number): PostConfig | null {
  const live = state.folded.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  if (live.length !== 2 || !live.includes(heroSeat)) return null;
  const btn = SEATS.indexOf("BTN");
  let id: string | null = null;
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  if (live.includes(btn) && live.includes(BB_SEAT)) {
    if (state.level === 1 && close(state.inv[btn], 2.5) && close(state.inv[BB_SEAT], 2.5)) id = "srp-btn-bb";
    else if (state.level === 2 && close(state.inv[btn], 11) && close(state.inv[BB_SEAT], 11)) id = "3bp-btn-bb";
  } else if (live.includes(SEATS.indexOf("CO")) && live.includes(BB_SEAT) && state.level === 1 && close(state.inv[BB_SEAT], 2.5)) id = "srp-co-bb";
  if (!id || !available.includes(id)) return null;
  const hero = heroSeat === BB_SEAT ? 0 : 1; // the big blind acts first after the flop
  return { kind: "through", scenario: id, hero, streets: [0, 1, 2], rng, timer, flop: null, heroClass };
}
