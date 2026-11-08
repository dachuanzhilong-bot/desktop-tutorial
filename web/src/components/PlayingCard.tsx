"use client";
import { motion, useReducedMotion } from "framer-motion";
import type { Card } from "@/lib/poker/hands";
import { RANK_CHARS } from "@/lib/poker/hands";
import { useSettings } from "@/lib/settings";

const GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" } as const;
const SUIT_NAME = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" } as const;

export function cardLabel(c: Card) {
  const r = RANK_CHARS[12 - c.rank];
  return `${r === "T" ? "10" : r} of ${SUIT_NAME[c.suit]}`;
}

export function PlayingCard({ card, size = "md", flip = false, delay = 0 }: { card: Card; size?: "sm" | "tbl" | "md" | "lg"; flip?: boolean; delay?: number }) {
  const { settings } = useSettings();
  const reduce = useReducedMotion();
  const dims = size === "lg" ? "h-24 w-[4.2rem] text-4xl" : size === "tbl" ? "h-[3.7rem] w-[2.6rem] text-xl" : size === "md" ? "h-[4.6rem] w-[3.2rem] text-2xl" : "h-12 w-8 text-base";
  const r = RANK_CHARS[12 - card.rank];
  return (
    <motion.div
      role="img"
      aria-label={cardLabel(card)}
      data-deck={settings.deck4 ? "4" : "2"}
      className={`card relative inline-grid ${dims} select-none place-items-center rounded-lg border border-black/20 bg-white font-extrabold leading-none shadow-md`}
      initial={flip && !reduce ? { rotateY: 90, opacity: 0 } : false}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.28, delay, ease: "easeOut" }}
      style={{ transformStyle: "preserve-3d" }}
    >
      <span data-suit={card.suit} className="flex flex-col items-center gap-0.5">
        <span>{r === "T" ? "10" : r}</span>
        <span className="-mt-0.5">{GLYPH[card.suit]}</span>
      </span>
    </motion.div>
  );
}

export function CardBack({ size = "sm" }: { size?: "sm" | "md" }) {
  const dims = size === "md" ? "h-[4.6rem] w-[3.2rem]" : "h-10 w-7";
  return (
    <span
      aria-hidden
      className={`inline-block ${dims} rounded-md border border-white/30 shadow`}
      style={{ background: "repeating-linear-gradient(45deg,#7a1f2b 0 4px,#5c1620 4px 8px)" }}
    />
  );
}
