"use client";
import type { Card } from "@/lib/poker/hands";
import { RANK_CHARS } from "@/lib/poker/hands";
import { useSettings } from "@/lib/settings";

const GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" } as const;
const SUIT_NAME = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" } as const;

export function cardLabel(c: Card) {
  const r = RANK_CHARS[12 - c.rank];
  return `${r === "T" ? "10" : r} of ${SUIT_NAME[c.suit]}`;
}

export const DIMS = { lg: "h-24 w-[4.2rem] text-4xl", tbl: "h-[3.7rem] w-[2.6rem] text-xl", md: "h-[4.6rem] w-[3.2rem] text-2xl", sm: "h-12 w-8 text-base" } as const;
export const CARD_CLASS = "card relative inline-grid select-none place-items-center rounded-lg border border-black/20 bg-white font-extrabold leading-none shadow-md";

export function Face({ card }: { card: Card }) {
  const r = RANK_CHARS[12 - card.rank];
  return (
    <span data-suit={card.suit} className="flex flex-col items-center gap-0.5">
      <span>{r === "T" ? "10" : r}</span>
      <span className="-mt-0.5">{GLYPH[card.suit]}</span>
    </span>
  );
}

/** A card face (static). Dealt cards that flip in use FlippingCard (components/FlippingCard.tsx). */
export function PlayingCard({ card, size = "md" }: { card: Card; size?: keyof typeof DIMS }) {
  const { settings } = useSettings();
  return (
    <div role="img" aria-label={cardLabel(card)} data-deck={settings.deck4 ? "4" : "2"} className={`${CARD_CLASS} ${DIMS[size]}`}>
      <Face card={card} />
    </div>
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
