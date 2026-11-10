"use client";
import { useEffect, useMemo, useState } from "react";
import { CardGrid } from "@/components/CardGrid";
import { PlayingCard, cardLabel } from "@/components/PlayingCard";
import { RangeField } from "@/components/solve/RangeField";
import { SolveTabs } from "@/components/solve/SolveTabs";
import { computeEquity, EquityError, playerFromHand, playerFromRange, validateBoard } from "@/lib/poker/equity";
import type { EquityPlayer, EquityResult } from "@/lib/poker/equity";
import { cardOf, parseCard } from "@/lib/postflop/combos";
import { parseRange, rangeCombos } from "@/lib/ranges/range";
import { useSettings } from "@/lib/settings";
import { getRepo } from "@/lib/storage/idb";
import type { SavedRange } from "@/lib/storage/types";
import { haptic } from "@/lib/util/haptics";
import { yieldToMain } from "@/lib/util/yield";

type Mode = "hand" | "range";
interface Seat {
  mode: Mode;
  cards: number[];
  /** kept when the seat is switched to a hand and back */
  text: string;
}

const MAX_SEATS = 4;
const DEALS = 200_000;
const DEALS_MORE = 1_000_000;
// a sample set up so the first view already shows a result: A♥K♥ against a range of strong hands
const START: Seat[] = [
  { mode: "hand", cards: [parseCard("Ah"), parseCard("Kh")], text: "AKs" },
  { mode: "range", cards: [], text: "TT+,AQs+,AKo" },
];

type Run = { key: string; progress: number; result: EquityResult | null; error: string | null };

export default function EquityPage() {
  const { t } = useSettings();
  const [seats, setSeats] = useState<Seat[]>(START);
  const [board, setBoard] = useState<number[]>([]);
  const [deals, setDeals] = useState(DEALS);
  const [saved, setSaved] = useState<SavedRange[]>([]);
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    getRepo()
      .listRanges()
      .then(setSaved)
      .catch(() => {});
  }, []);

  const who = (i: number) => (i === 0 ? t("equity.hero") : t("equity.opp", { n: i }));
  const used = useMemo(() => new Set([...seats.flatMap((s) => (s.mode === "hand" ? s.cards : [])), ...board]), [seats, board]);

  // ---- placing and taking out cards: a new card goes to the first empty place
  const place = (code: number) => {
    haptic.tap();
    const at = seats.findIndex((s) => s.mode === "hand" && s.cards.length < 2);
    if (at >= 0) setSeats(seats.map((s, i) => (i === at ? { ...s, cards: [...s.cards, code] } : s)));
    else if (board.length < 5) setBoard([...board, code]);
  };
  const take = (code: number) => {
    haptic.tap();
    setSeats(seats.map((s) => ({ ...s, cards: s.cards.filter((c) => c !== code) })));
    setBoard(board.filter((c) => c !== code));
  };
  const pick = (code: number) => (used.has(code) ? take(code) : place(code));
  const full = seats.every((s) => s.mode !== "hand" || s.cards.length === 2) && board.length >= 5;

  // ---- what to calculate: the players, or the reason there is nothing to calculate yet
  const setup = useMemo(() => {
    const boardProblem = validateBoard(board);
    const players: EquityPlayer[] = [];
    let need: string | null = boardProblem ? t("equity.need.board") : null;
    seats.forEach((s, i) => {
      if (s.mode === "hand") {
        if (s.cards.length === 2) players.push(playerFromHand(s.cards[0], s.cards[1]));
        else need ??= t("equity.need.hand", { who: who(i) });
      } else {
        const r = parseRange(s.text).range;
        if (rangeCombos(r) > 0) players.push(playerFromRange(r));
        else need ??= t("equity.need.range", { who: who(i) });
      }
    });
    return { players, need };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `who` only reads `t`
  }, [seats, board, t]);
  const key = JSON.stringify([seats.map((s) => (s.mode === "hand" ? s.cards : s.text)), board, deals]);

  useEffect(() => {
    if (setup.need) return;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const done = await computeEquity(setup.players, board, {
          samples: deals,
          signal: ctl.signal,
          yieldNow: yieldToMain,
          onProgress: (progress, partial) => setRun({ key, progress, result: partial, error: null }),
        });
        if (done) setRun({ key, progress: 1, result: done, error: null });
      } catch (e) {
        if (e instanceof EquityError) {
          const bad = seats.findIndex((s) => s.mode === "range");
          setRun({ key, progress: 0, result: null, error: t(`equity.err.${e.problem === "noCombos" ? "noCombos" : e.problem === "duplicateCard" ? "duplicate" : "impossible"}`, { who: who(Math.max(0, bad)) }) });
        } else throw e;
      }
    }, 180);
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for seats, board and deals
  }, [key, setup.need]);

  const mine = run?.key === key ? run : null;
  const result = mine?.result ?? null;
  const finished = !!mine && mine.progress >= 1;

  const slot = (code: number | undefined, label: string, emptyLabel: string) =>
    code === undefined ? (
      <span role="img" aria-label={emptyLabel} className="grid h-[3.7rem] w-[2.6rem] place-items-center rounded-lg border-2 border-dashed border-line text-muted">
        ?
      </span>
    ) : (
      <button type="button" onClick={() => take(code)} aria-label={label} className="grid min-h-tap min-w-tap place-items-center rounded-lg">
        <PlayingCard card={cardOf(code)} size="tbl" />
      </button>
    );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">{t("equity.title")}</h1>
        <p className="text-sm text-muted">{t("equity.subtitle")}</p>
      </header>
      <SolveTabs />

      {seats.map((s, i) => (
        <section key={i} className="space-y-2 rounded-card border border-line bg-surface p-3" aria-label={who(i)} data-testid={`seat-${i}`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">{who(i)}</h2>
            <div className="flex items-center gap-2">
              <div role="group" aria-label={t("equity.mode", { who: who(i) })} className="grid grid-cols-2 gap-1 rounded-control bg-surface-2 p-1">
                {(["hand", "range"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={s.mode === m}
                    data-testid={`seat-${i}-${m}`}
                    onClick={() => setSeats(seats.map((x, j) => (j === i ? { ...x, mode: m } : x)))}
                    className={`min-h-tap rounded-control px-3 text-sm font-bold ${s.mode === m ? "bg-accent text-accent-ink" : "text-muted"}`}
                  >
                    {t(m === "hand" ? "equity.modeHand" : "equity.modeRange")}
                  </button>
                ))}
              </div>
              {i >= 2 && (
                <button type="button" onClick={() => setSeats(seats.filter((_, j) => j !== i))} aria-label={t("equity.remove", { who: who(i) })} className="min-h-tap min-w-tap rounded-control border border-line text-lg font-bold">
                  ×
                </button>
              )}
            </div>
          </div>
          {s.mode === "hand" ? (
            <div className="flex items-center gap-2" data-testid={`seat-${i}-cards`}>
              {[0, 1].map((n) =>
                slot(
                  s.cards[n],
                  t("equity.slot", { who: who(i), n: n + 1, card: s.cards[n] === undefined ? "" : cardLabel(cardOf(s.cards[n])) }),
                  t("equity.slotEmpty", { who: who(i), n: n + 1 }),
                ),
              )}
              {s.cards.length > 0 && (
                <button type="button" onClick={() => setSeats(seats.map((x, j) => (j === i ? { ...x, cards: [] } : x)))} className="ml-auto min-h-tap rounded-control border border-line px-3 text-sm font-semibold">
                  {t("equity.clear")}
                </button>
              )}
            </div>
          ) : (
            <RangeField label={t("equity.modeRange")} text={s.text} onText={(text) => setSeats(seats.map((x, j) => (j === i ? { ...x, text } : x)))} saved={saved} testId={`seat-${i}-range`} />
          )}
        </section>
      ))}
      {seats.length < MAX_SEATS && (
        <button type="button" data-testid="equity-add" onClick={() => setSeats([...seats, { mode: "range", cards: [], text: "22+,A2s+,K9s+,QTs+,JTs,ATo+,KQo" }])} className="min-h-tap w-full rounded-control border border-line bg-surface font-semibold">
          + {t("equity.add")}
        </button>
      )}

      <section className="space-y-2 rounded-card border border-line bg-surface p-3" aria-label={t("equity.board")} data-testid="equity-board">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-bold">{t("equity.board")}</h2>
          <span className="text-xs text-muted">{t("equity.boardHint")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className={n === 3 ? "ml-2" : n === 4 ? "ml-1" : ""}>
              {slot(board[n], t("equity.boardSlot", { n: n + 1, card: board[n] === undefined ? "" : cardLabel(cardOf(board[n])) }), t("equity.boardSlotEmpty", { n: n + 1 }))}
            </span>
          ))}
          {board.length > 0 && (
            <button type="button" onClick={() => setBoard([])} className="ml-auto min-h-tap rounded-control border border-line px-3 text-sm font-semibold">
              {t("equity.clear")}
            </button>
          )}
        </div>
      </section>

      <section className="space-y-2 rounded-card border border-line bg-surface p-3" aria-label={t("equity.result")} data-testid="equity-result" aria-live="polite">
        <h2 className="font-bold">{t("equity.result")}</h2>
        {setup.need ? (
          <p role="status" className="text-sm text-muted" data-testid="equity-need">
            {setup.need}
          </p>
        ) : mine?.error ? (
          <p role="alert" className="rounded-control border border-line bg-surface-2 p-2 text-sm font-semibold">
            {mine.error}
          </p>
        ) : !result ? (
          <p className="text-sm text-muted">{t("equity.computing", { pct: 0 })}</p>
        ) : (
          <>
            <ul className="space-y-3">
              {result.players.map((p, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold">{who(i)}</span>
                    <span className="text-2xl font-black tabular-nums" data-testid={`equity-${i}`}>
                      {(p.equity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <span className="bg-accent" style={{ width: `${p.win * 100}%` }} />
                    <span className="bg-accent/45" style={{ width: `${p.tie * 100}%` }} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {t("equity.win", { pct: (p.win * 100).toFixed(1) })} · {t("equity.tie", { pct: (p.tie * 100).toFixed(1) })}
                  </p>
                </li>
              ))}
            </ul>
            {!finished ? (
              <p className="text-xs text-muted">{t("equity.computing", { pct: Math.round((mine?.progress ?? 0) * 100) })}</p>
            ) : (
              <p className="text-xs text-muted" data-testid="equity-basis">
                {result.exact
                  ? t("equity.exact", { n: result.boards.toLocaleString("en-US") })
                  : t("equity.sampled", { n: result.boards.toLocaleString("en-US"), e: (Math.max(...result.players.map((p) => p.stdErr)) * 100).toFixed(2) })}
              </p>
            )}
            {finished && !result.exact && deals < DEALS_MORE && (
              <button type="button" data-testid="equity-more" onClick={() => setDeals(DEALS_MORE)} className="min-h-tap rounded-control border border-line px-3 text-sm font-semibold">
                {t("equity.more", { n: DEALS_MORE.toLocaleString("en-US") })}
              </button>
            )}
          </>
        )}
      </section>

      <section className="space-y-2" aria-label={t("equity.pick")}>
        <p className="text-xs text-muted">{t("equity.pickHint")}</p>
        <CardGrid label={t("equity.pick")} on={(c) => used.has(c)} off={(c) => full && !used.has(c)} onPick={pick} />
      </section>
      <p className="text-xs text-muted">{t("equity.note")}</p>
    </div>
  );
}
