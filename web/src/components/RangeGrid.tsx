"use client";
import { KeyboardEvent, PointerEvent, memo, useCallback, useRef } from "react";
import { ALL_CLASSES, NUM_CLASSES } from "@/lib/poker/hands";
import { ActionKind } from "@/lib/solution/types";
import type { NodeSolution } from "@/lib/solution/types";

export type GridMode = "strategy" | "ev" | "equity" | "weight";
export type Tone = "fold" | "call" | "raise1" | "raise2" | "allin";

export interface GridAction {
  kind: ActionKind;
  /** tone used for colouring (raise sizes get darker with the raise level) */
  tone: Tone;
  label: string;
}

export function toneFor(kind: ActionKind, levelBefore: number): Tone {
  if (kind === ActionKind.Fold) return "fold";
  if (kind === ActionKind.Call) return "call";
  if (kind === ActionKind.AllIn) return "allin";
  return levelBefore >= 2 ? "raise2" : "raise1";
}

const STOPS = [
  [0x23, 0x39, 0x5b],
  [0x2a, 0x9d, 0x8f],
  [0xf4, 0xd3, 0x5e],
];
function ramp(t: number): { bg: string; fg: string } {
  const x = Math.min(1, Math.max(0, t)) * 2;
  const i = Math.min(1, Math.floor(x));
  const f = x - i;
  const c = STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
  const lin = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const white = 1.05 / (L + 0.05);
  const black = (L + 0.05) / 0.05;
  return { bg: `rgb(${c.join(",")})`, fg: white >= black ? "#fff" : "#000" };
}

interface Props {
  sol: NodeSolution | null;
  actions: GridAction[];
  mode: GridMode;
  selected: number | null;
  marker?: number | null;
  onSelect?: (cls: number) => void;
  onLongPress?: (cls: number, el: HTMLElement) => void;
  /** classes for which this returns false are dimmed */
  filter?: (cls: number) => boolean;
  showNumbers?: boolean;
  ariaLabel: string;
  /** no text in the cells (tiny thumbnails) */
  bare?: boolean;
  className?: string;
}

const LONG_MS = 380;

function RangeGridInner({ sol, actions, mode, selected, marker, onSelect, onLongPress, filter, showNumbers = true, ariaLabel, className, bare }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  const clsFromEvent = (e: { target: EventTarget }) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cls]");
    return el ? { el, cls: Number(el.dataset.cls) } : null;
  };

  const down = useCallback(
    (e: PointerEvent) => {
      const hit = clsFromEvent(e);
      if (!hit || !onLongPress) return;
      longFired.current = false;
      timer.current = setTimeout(() => {
        longFired.current = true;
        onLongPress(hit.cls, hit.el);
      }, LONG_MS);
    },
    [onLongPress],
  );
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const click = useCallback(
    (e: React.MouseEvent) => {
      const hit = clsFromEvent(e);
      if (!hit) return;
      if (longFired.current) {
        longFired.current = false;
        return;
      }
      onSelect?.(hit.cls);
    },
    [onSelect],
  );
  const keydown = useCallback(
    (e: KeyboardEvent) => {
      const hit = clsFromEvent(e);
      if (!hit) return;
      let { cls } = hit;
      const row = Math.floor(cls / 13);
      const col = cls % 13;
      const move = (r: number, c: number) => Math.min(12, Math.max(0, r)) * 13 + Math.min(12, Math.max(0, c));
      if (e.key === "ArrowRight") cls = move(row, col + 1);
      else if (e.key === "ArrowLeft") cls = move(row, col - 1);
      else if (e.key === "ArrowDown") cls = move(row + 1, col);
      else if (e.key === "ArrowUp") cls = move(row - 1, col);
      else return;
      e.preventDefault();
      onSelect?.(cls);
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-cls="${cls}"]`)?.focus());
    },
    [onSelect],
  );

  const na = sol?.na ?? 0;
  const bestEv = (h: number) => {
    let b = -Infinity;
    for (let a = 0; a < na; a++) b = Math.max(b, sol!.ev[a * NUM_CLASSES + h]);
    return b;
  };

  return (
    <div
      ref={root}
      role="group"
      aria-label={ariaLabel}
      className={`grid13 ${className ?? ""}`}
      onPointerDown={down}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onPointerMove={(e) => {
        // moving the finger (scroll) cancels the long press
        if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onClick={click}
      onKeyDown={keydown}
    >
      {ALL_CLASSES.map((c) => {
        const h = c.id;
        const w = sol ? sol.weight[h] : 0;
        const inRange = w >= 0.01;
        const dim = filter ? !filter(h) : false;
        const common = {
          key: h,
          type: "button" as const,
          "data-cls": h,
          "data-dim": dim,
          "data-selected": selected === h,
          "data-marker": marker === h,
          tabIndex: (selected ?? 0) === h || (selected === null && h === 0) ? 0 : -1,
          className: "cell",
        };
        if (!sol) return <button {...common} aria-label={c.name} disabled />;

        // aria text
        const parts: string[] = [];
        for (let a = 0; a < na; a++) {
          const f = sol.freq[a * NUM_CLASSES + h];
          if (f >= 0.005) parts.push(`${actions[a]?.label} ${Math.round(f * 100)}%`);
        }
        const aria = `${c.name}: ${inRange ? parts.join(", ") : "—"}`;

        if (mode === "strategy") {
          let topA = 0;
          for (let a = 1; a < na; a++) if (sol.freq[a * NUM_CLASSES + h] > sol.freq[topA * NUM_CLASSES + h]) topA = a;
          const topF = sol.freq[topA * NUM_CLASSES + h];
          return (
            <button {...common} data-empty={!inRange} aria-label={aria}>
              {inRange && (
                <span className="fill" style={{ height: `${Math.min(1, w) * 100}%` }}>
                  {actions.map((act, a) => {
                    const f = sol.freq[a * NUM_CLASSES + h];
                    return f > 0.004 ? <span key={a} className="seg" data-k={act.tone} style={{ width: `${f * 100}%` }} /> : null;
                  })}
                </span>
              )}
              {!bare && (
                <span className="lbl">
                  <span className="flex flex-col items-center gap-[1px]">
                    <span>{c.name}</span>
                    {showNumbers && inRange && topF < 0.995 && <span className="pct" data-v={Math.round(topF * 100)} />}
                  </span>
                </span>
              )}
            </button>
          );
        }

        let value = 0;
        let text = "";
        let t = 0;
        if (mode === "ev") {
          value = bestEv(h);
          t = (value + 1.5) / 5;
          text = (value >= 0 ? "+" : "") + value.toFixed(1);
        } else if (mode === "equity") {
          value = sol.equity[h];
          t = (value - 0.25) / 0.6;
          text = Math.round(value * 100) + "";
        } else {
          value = w;
          t = w;
          text = Math.round(w * 100) + "";
        }
        const { bg, fg } = ramp(t);
        return (
          <button {...common} data-empty={!inRange && mode !== "equity"} aria-label={`${aria}; ${mode} ${text}`} style={mode === "weight" && !inRange ? undefined : { background: bg, color: fg }}>
            <span className="lbl" style={{ color: mode === "weight" && !inRange ? undefined : fg, textShadow: "none" }}>
              <span className="flex flex-col items-center gap-[1px]">
                <span>{c.name}</span>
                {showNumbers && <span className="pct" data-v={text} />}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const RangeGrid = memo(RangeGridInner);

/** colour legend for the action tones */
export function ActionLegend({ actions, className = "" }: { actions: GridAction[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-sm ${className}`}>
      {actions.map((a, i) => (
        <li key={i} className="flex items-center gap-1.5">
          <span aria-hidden className="seg inline-block h-3.5 w-3.5 rounded-[4px]" data-k={a.tone} />
          {a.label}
        </li>
      ))}
    </ul>
  );
}
