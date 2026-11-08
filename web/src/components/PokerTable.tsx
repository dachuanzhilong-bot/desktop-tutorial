"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Card } from "@/lib/poker/hands";
import { fmtBB } from "@/lib/solution/tree";
import type { PublicState } from "@/lib/solution/types";
import { CardBack, PlayingCard } from "./PlayingCard";

interface Props {
  seats: readonly string[];
  hero: number;
  state: PublicState;
  stack: number;
  /** seat currently to act */
  actor: number | null;
  /** last action text per seat (e.g. "Raise 2.5") */
  lastAction: (string | null)[];
  heroCards: [Card, Card] | null;
  dealer?: number;
  potLabel: string;
}

/** seat k (0 = hero, going clockwise) -> position on the oval, in % */
function seatPos(k: number) {
  const a = (90 + k * 60) * (Math.PI / 180);
  return { x: 50 + 41 * Math.cos(a), y: 44 + 33 * Math.sin(a) };
}

export function PokerTable({ seats, hero, state, stack, actor, lastAction, heroCards, dealer = 3, potLabel }: Props) {
  const reduce = useReducedMotion();
  const n = seats.length;
  return (
    <div className="felt relative mx-auto aspect-[4/3.5] w-full max-w-md rounded-[2.8rem]" role="group" aria-label={`Table, ${potLabel} ${fmtBB(state.pot)}bb`}>
      {/* pot */}
      <div className="absolute left-1/2 top-[36%] -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="text-[0.7rem] font-semibold tracking-wide text-white/70">{potLabel}</div>
        <motion.div key={state.pot} initial={reduce ? false : { scale: 1.25 }} animate={{ scale: 1 }} className="text-xl font-extrabold text-white" aria-live="polite">
          {fmtBB(state.pot)}
          <span className="text-xs font-semibold"> bb</span>
        </motion.div>
      </div>

      {Array.from({ length: n }, (_, i) => {
        const k = (i - hero + n) % n;
        const p = seatPos(k);
        const bet = state.inv[i];
        const folded = state.folded[i];
        const isHero = i === hero;
        // bets sit between the seat and the pot; the hero's chips go beside the hole cards
        const toCenter = isHero ? { x: 72, y: 62 } : { x: 50 + (p.x - 50) * 0.55, y: 42 + (p.y - 42) * 0.55 };
        return (
          <div key={i}>
            {/* bet chips */}
            <AnimatePresence>
              {bet > 0 && !folded && (
                <motion.div
                  key={`bet-${i}-${bet}`}
                  className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-bold text-white"
                  initial={reduce ? false : { left: `${p.x}%`, top: `${p.y}%`, opacity: 0, scale: 0.6 }}
                  animate={{ left: `${toCenter.x}%`, top: `${toCenter.y}%`, opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24 }}
                >
                  <span aria-hidden className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-white bg-accent" />
                  {fmtBB(bet)}
                </motion.div>
              )}
            </AnimatePresence>
            {/* seat */}
            <div className="absolute z-20 -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              {!isHero && !folded && (
                <div className="mb-0.5 flex justify-center gap-0.5" aria-hidden>
                  <CardBack />
                  <CardBack />
                </div>
              )}
              {isHero && heroCards && (
                <div className="mb-1 flex justify-center gap-1">
                  <PlayingCard card={heroCards[0]} size="tbl" flip delay={0.05} />
                  <PlayingCard card={heroCards[1]} size="tbl" flip delay={0.16} />
                </div>
              )}
              <div
                className={`relative mx-auto inline-block min-w-[3.6rem] rounded-xl border px-2 py-1 leading-tight shadow ${
                  actor === i ? "border-accent bg-surface text-ink ring-2 ring-accent" : "border-white/20 bg-black/55 text-white"
                } ${folded ? "opacity-40" : ""}`}
              >
                <div className="text-xs font-extrabold">{seats[i]}</div>
                <div className="text-[0.68rem] font-semibold opacity-85">{fmtBB(Math.max(0, stack - bet))}</div>
                {i === dealer && (
                  <span aria-label="Dealer" className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-white text-[0.65rem] font-extrabold text-black shadow">
                    D
                  </span>
                )}
              </div>
              <AnimatePresence mode="wait">
                {lastAction[i] && (
                  <motion.div
                    key={lastAction[i]}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-0.5 text-[0.68rem] font-bold text-white drop-shadow"
                  >
                    {lastAction[i]}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </div>
  );
}
