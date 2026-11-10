"use client";
import { CardGrid } from "@/components/CardGrid";
import { PlayingCard, cardLabel } from "@/components/PlayingCard";
import { cardOf } from "@/lib/postflop/combos";
import { useSettings } from "@/lib/settings";
import { haptic } from "@/lib/util/haptics";

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
  const { t } = useSettings();
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
      <CardGrid label={t("solve.board")} on={(c) => board.includes(c)} off={(c) => full && !board.includes(c)} onPick={toggle} />
    </section>
  );
}
