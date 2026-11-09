"use client";
import { PlayingCard, cardLabel } from "@/components/PlayingCard";
import { cardOf } from "@/lib/postflop/combos";
import { useSettings } from "@/lib/settings";
import { haptic } from "@/lib/util/haptics";

const GLYPH = ["♣", "♦", "♥", "♠"];
const SUIT_VAR = ["--suit-c", "--suit-d", "--suit-h", "--suit-s"];
const RANKS = "AKQJT98765432";
const SUIT_ORDER = [3, 2, 1, 0]; // s h d c (card = rank*4 + suit with suit 0..3 = c d h s)

export function randomFlop(): number[] {
  const out: number[] = [];
  while (out.length < 3) {
    const c = Math.floor(Math.random() * 52);
    if (!out.includes(c)) out.push(c);
  }
  return out.sort((a, b) => b - a);
}

/** pick 3 to 5 board cards from a 52-card chart; tap a selected card to take it off */
export function BoardPicker({ board, onChange }: { board: number[]; onChange: (b: number[]) => void }) {
  const { t, settings } = useSettings();
  const toggle = (c: number) => {
    haptic.tap();
    if (board.includes(c)) onChange(board.filter((x) => x !== c));
    else if (board.length < 5) onChange([...board, c]);
  };
  const full = board.length >= 5;
  return (
    <section className="space-y-3" aria-label={t("solve.board")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{t("solve.board")}</h2>
        <span className="text-sm text-muted" data-testid="board-count">
          {t("solve.boardCount", { n: board.length })}
        </span>
      </div>
      <p className="text-xs text-muted">{t("solve.boardHint")}</p>
      <div className="flex min-h-[4.2rem] items-center gap-1.5 rounded-card bg-surface p-2" data-testid="board-cards" aria-live="polite">
        {board.map((c, i) => (
          <button key={c} type="button" onClick={() => toggle(c)} className={`grid min-h-tap min-w-tap place-items-center rounded-lg ${i === 3 ? "ml-2" : ""} ${i === 4 ? "ml-1" : ""}`} aria-label={t("solve.removeCard", { card: cardLabel(cardOf(c)) })}>
            <PlayingCard card={cardOf(c)} size="tbl" />
          </button>
        ))}
        {board.length < 3 && <span className="px-1 text-sm text-muted">{t("solve.boardHint")}</span>}
      </div>
      <div className="flex gap-2">
        <button type="button" data-testid="board-random" onClick={() => onChange(randomFlop())} className="min-h-tap rounded-control border border-line bg-surface px-3.5 text-sm font-semibold">
          {t("solve.random")}
        </button>
        <button type="button" onClick={() => onChange([])} className="min-h-tap rounded-control border border-line bg-surface px-3.5 text-sm font-semibold">
          {t("solve.clear")}
        </button>
      </div>
      {/* 52 cards have to fit a phone width: about 27 x 40 px each (WCAG 2.5.8 minimum is 24) */}
      <div className="space-y-[3px]" role="group" aria-label={t("solve.board")} data-card-picker>
        {SUIT_ORDER.map((s) => (
          <div key={s} className="grid grid-cols-13 gap-[2px]" style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}>
            {RANKS.split("").map((r, i) => {
              const code = (12 - i) * 4 + s;
              const on = board.includes(code);
              const disabled = !on && full;
              const four = settings.deck4;
              const colour = four ? `var(${SUIT_VAR[s]})` : s >= 2 ? "var(--suit-h)" : "var(--suit-s)";
              return (
                <button
                  key={code}
                  type="button"
                  data-testid={`pick-${r}${"cdhs"[s]}`}
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => toggle(code)}
                  style={{ color: colour }}
                  className={`flex h-10 min-w-0 flex-col items-center justify-center rounded-md border-2 bg-white text-[0.72rem] font-extrabold leading-none disabled:opacity-35 ${on ? "border-accent ring-2 ring-accent" : "border-black/15"}`}
                >
                  <span>{r === "T" ? "10" : r}</span>
                  <span className="text-[0.8rem]">{GLYPH[s]}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
