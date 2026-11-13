/** random practice records for the storage tests (statsCache.test.ts, statsPerf.test.ts): seeded, so runs repeat */
import { GRADES } from "../practice/grading";
import { ALL_SPOT_COLUMNS } from "../solution/types";
import type { Attempt } from "../storage/types";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

const PRE_POS = ["F-F-R2.5", "R2.5", "F-R2.5-R8", "F-F-F-R2.5-F"];
const POST_POS = ["9s6d3c@X", "9s6d3c@X-B33", "KhTd4s@B33-C/Ad", "7c7d2h@X-X/2s-X"];

/**
 * One record. Pre-flop and post-flop mixed; positions and hands are drawn from small sets so that the notebook
 * (one entry per solution, position and hand) sees repeats.
 */
export function randomAttempt(r: () => number, ts: number): Attempt {
  const post = r() < 0.4;
  const grade = GRADES[Math.floor(r() * GRADES.length)];
  const spot = post ? (["postFlop", "postTurn", "postRiver"] as const)[Math.floor(r() * 3)] : ALL_SPOT_COLUMNS[Math.floor(r() * (ALL_SPOT_COLUMNS.length - 3))];
  const evLoss = grade === "best" ? 0 : Math.round(r() * 1.2 * 1000) / 1000 + r() * 1e-6;
  return {
    ts,
    sessionId: `s${Math.floor(r() * 50)}`,
    mode: post ? (r() < 0.5 ? "post" : "postSpot") : r() < 0.5 ? "spot" : "hand",
    solution: post ? "post:srp-btn-bb" : r() < 0.5 ? "cash6max-100bb" : "cash6max-40bb",
    nodeId: Math.floor(r() * 300),
    pos: (post ? POST_POS : PRE_POS)[Math.floor(r() * 4)],
    build: "b1",
    hand: post ? Math.floor(r() * 12) * 100 : Math.floor(r() * 12),
    seat: Math.floor(r() * 6),
    spot,
    chosen: Math.floor(r() * 3),
    best: Math.floor(r() * 3),
    grade,
    evLoss,
    score: Math.max(0, Math.round(100 - evLoss * 125)),
    ms: Math.floor(r() * 20_000),
    rng: r() < 0.1,
    timeout: r() < 0.05,
    hint: r() < 0.05,
  };
}

const DAY = 86_400_000;

/** `n` records spread over the `days` days before `now`, in time order (as a device records them) */
export function randomHistory(seed: number, n: number, now: number, days = 365): Attempt[] {
  const r = rng(seed);
  const times = Array.from({ length: n }, () => now - Math.floor(r() * days * DAY)).sort((a, b) => a - b);
  return times.map((ts) => randomAttempt(r, ts));
}
