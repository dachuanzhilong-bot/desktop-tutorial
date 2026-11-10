"use client";
import { motion, useReducedMotion } from "framer-motion";
import type { Card } from "@/lib/poker/hands";
import { useSettings } from "@/lib/settings";
import { CARD_CLASS, cardLabel, DIMS, Face } from "./PlayingCard";

/** A dealt card that turns over (practice tables). Kept apart so pages without animation do not load framer-motion. */
export function FlippingCard({ card, size = "md", delay = 0 }: { card: Card; size?: keyof typeof DIMS; delay?: number }) {
  const { settings } = useSettings();
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="img"
      aria-label={cardLabel(card)}
      data-deck={settings.deck4 ? "4" : "2"}
      className={`${CARD_CLASS} ${DIMS[size]}`}
      initial={reduce ? false : { rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.28, delay, ease: "easeOut" }}
      style={{ transformStyle: "preserve-3d" }}
    >
      <Face card={card} />
    </motion.div>
  );
}
