"use client";
import { useSettings } from "@/lib/settings";

const GLYPH = ["♣", "♦", "♥", "♠"];
const SUIT_VAR = ["--suit-c", "--suit-d", "--suit-h", "--suit-s"];
const RANKS = "AKQJT98765432";
const SUIT_ORDER = [3, 2, 1, 0]; // s h d c (card = rank*4 + suit with suit 0..3 = c d h s)

/**
 * The 52 cards in four rows (one per suit), 13 across. They have to fit a phone width: about 27 x 40 px each
 * (WCAG 2.5.8 asks for 24). `on` = already chosen (shown ringed), `off` = cannot be chosen now.
 */
export function CardGrid({ label, on, off, onPick }: { label: string; on: (code: number) => boolean; off?: (code: number) => boolean; onPick: (code: number) => void }) {
  const { settings } = useSettings();
  return (
    <div className="space-y-[3px]" role="group" aria-label={label} data-card-picker>
      {SUIT_ORDER.map((s) => (
        <div key={s} className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
          {RANKS.split("").map((r, i) => {
            const code = (12 - i) * 4 + s;
            const chosen = on(code);
            const colour = settings.deck4 ? `var(${SUIT_VAR[s]})` : s >= 2 ? "var(--suit-h)" : "var(--suit-s)";
            return (
              <button
                key={code}
                type="button"
                data-testid={`pick-${r}${"cdhs"[s]}`}
                aria-pressed={chosen}
                disabled={!!off?.(code)}
                onClick={() => onPick(code)}
                style={{ color: colour }}
                className={`flex h-10 min-w-0 flex-col items-center justify-center rounded-md border-2 bg-white text-[0.72rem] font-extrabold leading-none disabled:opacity-35 ${chosen ? "border-accent ring-2 ring-accent" : "border-black/15"}`}
              >
                <span>{r === "T" ? "10" : r}</span>
                <span className="text-[0.8rem]">{GLYPH[s]}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
