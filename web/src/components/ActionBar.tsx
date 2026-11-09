"use client";
import { PointerEvent, useCallback, useRef } from "react";
import { fmtBB } from "@/lib/solution/tree";
import type { GridAction } from "./RangeGrid";
import { ActionKind } from "@/lib/solution/types";

export interface BarAction extends GridAction {
  to: number;
  key: string; // keyboard shortcut label
  /** shown after a long press (hint) */
  hint?: string | null;
}

/** Big thumb-friendly action buttons. Long-press reveals the GTO frequency (a hint). */
export function ActionBar({
  actions,
  disabled,
  onChoose,
  onHint,
  highlight,
}: {
  actions: BarAction[];
  disabled?: boolean;
  onChoose: (index: number) => void;
  onHint?: (index: number) => void;
  /** index to outline (used by the RNG mode result) */
  highlight?: number | null;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const start = useCallback(
    (i: number) => (_e: PointerEvent) => {
      fired.current = false;
      if (!onHint) return;
      timer.current = setTimeout(() => {
        fired.current = true;
        onHint(i);
      }, 450);
    },
    [onHint],
  );
  const end = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }} role="group" aria-label="Actions">
      {actions.map((a, i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          data-testid={`action-${a.kind}`}
          aria-keyshortcuts={a.key}
          onPointerDown={start(i)}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (fired.current) {
              fired.current = false;
              return;
            }
            onChoose(i);
          }}
          className="seg relative flex min-h-16 select-none flex-col items-center justify-center gap-0.5 rounded-card px-2 py-2 text-white shadow-lg transition-transform duration-100 active:scale-[0.96] disabled:opacity-45"
          data-k={a.tone}
          style={highlight === i ? { outline: "4px solid var(--accent)", outlineOffset: 2 } : undefined}
        >
          <span className="text-base font-extrabold leading-tight sm:text-lg">{a.label}</span>
          {a.kind !== ActionKind.Fold && a.to > 0 && <span className="text-sm font-semibold opacity-95">{fmtBB(a.to)}</span>}
          {a.hint && <span className="absolute -top-3 rounded-full bg-black/85 px-2 py-0.5 text-xs font-bold text-white">{a.hint}</span>}
          <kbd className="absolute right-1.5 top-1 hidden rounded border border-white/40 px-1 text-[0.6rem] font-bold opacity-80 sm:block">{a.key}</kbd>
        </button>
      ))}
    </div>
  );
}
