"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CardBack, PlayingCard } from "@/components/PlayingCard";
import type { Card } from "@/lib/poker/hands";
import { cardOf } from "@/lib/postflop/combos";
import { fmtBB } from "@/lib/solution/tree";

interface Props {
  seats: [string, string]; // [OOP, IP]
  hero: 0 | 1;
  board: number[];
  pot: number;
  /** chips each player has on this street */
  streetInv: [number, number];
  /** chips behind */
  stacks: [number, number];
  actor: number | null;
  lastAction: (string | null)[];
  heroCards: [Card, Card] | null;
  folded?: number | null;
  potLabel: string;
}

/** Heads-up postflop table: the villain on top, the hero at the bottom, the board in the middle. */
export function PostTable({ seats, hero, board, pot, streetInv, stacks, actor, lastAction, heroCards, folded, potLabel }: Props) {
  const reduce = useReducedMotion();
  const villain = (1 - hero) as 0 | 1;
  const seat = (p: 0 | 1, top: boolean) => (
    <div className={`absolute left-1/2 z-20 -translate-x-1/2 text-center ${top ? "top-2" : "bottom-2"}`}>
      {top && folded !== p && (
        <div className="mb-0.5 flex justify-center gap-0.5" aria-hidden>
          <CardBack />
          <CardBack />
        </div>
      )}
      {!top && heroCards && (
        <div className="mb-1 flex justify-center gap-1">
          <PlayingCard card={heroCards[0]} size="tbl" flip delay={0.05} />
          <PlayingCard card={heroCards[1]} size="tbl" flip delay={0.16} />
        </div>
      )}
      <div className={`mx-auto inline-block min-w-[4rem] rounded-control border px-2.5 py-1 leading-tight shadow ${actor === p ? "border-accent bg-surface text-ink ring-2 ring-accent" : "border-white/20 bg-black/55 text-white"} ${folded === p ? "opacity-40" : ""}`}>
        <div className="text-xs font-extrabold">{seats[p]}</div>
        <div className="text-[0.68rem] font-semibold opacity-85">{fmtBB(stacks[p])}</div>
      </div>
      <AnimatePresence mode="wait">
        {lastAction[p] && (
          <motion.div key={lastAction[p]} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-0.5 text-[0.7rem] font-bold text-white drop-shadow">
            {lastAction[p]}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
  const chip = (p: 0 | 1, top: boolean) =>
    streetInv[p] > 0 && folded !== p ? (
      <motion.div
        key={`${p}-${streetInv[p]}`}
        className={`absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-bold text-white ${top ? "top-[31%]" : "bottom-[24%] translate-x-[7.5rem]"}`}
        initial={reduce ? false : { y: top ? -30 : 30, opacity: 0, scale: 0.6 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
      >
        <span aria-hidden className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-white bg-accent" />
        {fmtBB(streetInv[p])}
      </motion.div>
    ) : null;
  return (
    <div className="felt relative mx-auto aspect-[4/4.6] w-full max-w-md rounded-[2.8rem]" role="group" aria-label={`Table, ${potLabel} ${fmtBB(pot)}bb`} data-testid="post-table">
      {seat(villain, true)}
      {chip(villain, true)}
      <div className="absolute left-1/2 top-[47%] z-10 -translate-x-1/2 -translate-y-1/2 text-center">
        <div className="mb-1 flex items-center justify-center gap-1" aria-label="board">
          {board.map((c, i) => (
            <span key={c} className={i === 3 || i === 4 ? "ml-1" : ""}>
              <PlayingCard card={cardOf(c)} size="tbl" flip={i >= 3} />
            </span>
          ))}
        </div>
        <div className="text-[0.7rem] font-semibold tracking-wide text-white/70">{potLabel}</div>
        <motion.div key={pot} initial={reduce ? false : { scale: 1.2 }} animate={{ scale: 1 }} className="text-xl font-extrabold text-white" aria-live="polite">
          {fmtBB(pot)}
          <span className="text-xs font-semibold"> bb</span>
        </motion.div>
      </div>
      {chip(hero, false)}
      {seat(hero, false)}
    </div>
  );
}

/** one-line summary of the table (board, hero's cards, pot) used next to the result card */
export function PostTableMini({ board, heroCards, pot, potLabel, lastAction, hero }: { board: number[]; heroCards: [Card, Card] | null; pot: number; potLabel: string; lastAction: string | null; hero: string }) {
  return (
    <div className="felt flex items-center justify-between gap-2 rounded-card px-3 py-2" role="group" aria-label={`Table, ${potLabel} ${fmtBB(pot)}bb`} data-testid="post-table-mini">
      <div className="flex gap-1" aria-label="board">
        {board.map((c) => (
          <PlayingCard key={c} card={cardOf(c)} size="sm" />
        ))}
      </div>
      <div className="text-center text-white">
        <div className="text-[0.62rem] font-semibold opacity-70">{potLabel}</div>
        <div className="text-base font-extrabold">{fmtBB(pot)}<span className="text-[0.62rem] font-semibold"> bb</span></div>
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <div className="flex gap-0.5">{heroCards && heroCards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)}</div>
        <div className="text-[0.65rem] font-bold text-white">{hero}{lastAction ? ` · ${lastAction}` : ""}</div>
      </div>
    </div>
  );
}
