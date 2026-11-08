"use client";
import { memo, useRef } from "react";
import type { PointerEvent, KeyboardEvent } from "react";
import { ALL_CLASSES } from "@/lib/poker/hands";

interface Props {
  /** 169 weights 0..1 */
  value: ArrayLike<number>;
  /** a reference range: with `overlay` the cells show what is missing / extra compared to it */
  reference?: ArrayLike<number> | null;
  overlay?: boolean;
  /** drag-paint: called with every cell the pointer enters (and the one it starts on) */
  onPaint?: (cls: number, phase: "start" | "move") => void;
  onPaintEnd?: () => void;
  onSelect?: (cls: number) => void;
  selected?: number | null;
  ariaLabel: string;
  cellLabel?: (name: string, w: number) => string;
  /** tiny preview without text */
  bare?: boolean;
  className?: string;
}

function RangeCellsInner({ value, reference, overlay, onPaint, onPaintEnd, onSelect, selected, ariaLabel, cellLabel, bare, className }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; last: number } | null>(null);
  const paintable = !!onPaint;

  const clsAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cls]");
    return el && root.current?.contains(el) ? Number(el.dataset.cls) : null;
  };

  const down = (e: PointerEvent) => {
    if (!paintable || (e.pointerType === "mouse" && e.button !== 0)) return;
    const c = clsAt(e.clientX, e.clientY);
    if (c === null) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, last: c };
    onPaint!(c, "start");
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const c = clsAt(e.clientX, e.clientY);
    if (c === null || c === d.last) return;
    d.last = c;
    onPaint!(c, "move");
  };
  const up = (e: PointerEvent) => {
    if (drag.current?.id === e.pointerId) {
      drag.current = null;
      onPaintEnd?.();
    }
  };
  const key = (e: KeyboardEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cls]");
    if (!el) return;
    const cls = Number(el.dataset.cls);
    const row = Math.floor(cls / 13);
    const col = cls % 13;
    const mv = (r: number, c: number) => Math.min(12, Math.max(0, r)) * 13 + Math.min(12, Math.max(0, c));
    let next = cls;
    if (e.key === "ArrowRight") next = mv(row, col + 1);
    else if (e.key === "ArrowLeft") next = mv(row, col - 1);
    else if (e.key === "ArrowDown") next = mv(row + 1, col);
    else if (e.key === "ArrowUp") next = mv(row - 1, col);
    else if ((e.key === "Enter" || e.key === " ") && paintable) {
      e.preventDefault();
      onPaint!(cls, "start");
      onPaintEnd?.();
      return;
    } else return;
    e.preventDefault();
    root.current?.querySelector<HTMLElement>(`[data-cls="${next}"]`)?.focus();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- event delegation for the 169 cell <button>s inside (drag-paint, roving arrow-key focus)
    <div
      ref={root}
      role="group"
      aria-label={ariaLabel}
      className={`grid13 ${paintable ? "touch-none" : ""} ${className ?? ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onContextMenu={(e) => e.preventDefault()}
    >
      {ALL_CLASSES.map((c) => {
        const a = value[c.id];
        const b = reference ? reference[c.id] : 0;
        const show = overlay && reference;
        const h = show ? Math.max(a, b) : a;
        const label = cellLabel ? cellLabel(c.name, a) : `${c.name}: ${Math.round(a * 100)}%`;
        const ok = Math.min(a, b);
        const miss = Math.max(0, b - a);
        const extra = Math.max(0, a - b);
        return (
          <button
            key={c.id}
            type="button"
            data-cls={c.id}
            data-empty={h < 0.005}
            data-selected={selected === c.id}
            tabIndex={c.id === 0 ? 0 : -1}
            aria-label={label}
            className="cell"
            onClick={onSelect && !paintable ? () => onSelect(c.id) : undefined}
          >
            {h >= 0.005 && (
              <span className="fill" style={{ height: `${Math.min(1, h) * 100}%` }}>
                {show ? (
                  <>
                    {ok > 0 && <span className="seg" data-k="call" style={{ width: `${(ok / h) * 100}%` }} />}
                    {miss > 0 && <span className="seg" data-k="fold" style={{ width: `${(miss / h) * 100}%` }} />}
                    {extra > 0 && <span className="seg" data-k="raise1" style={{ width: `${(extra / h) * 100}%` }} />}
                  </>
                ) : (
                  <span className="seg" data-k="call" style={{ width: "100%" }} />
                )}
              </span>
            )}
            {!bare && (
              <span className="lbl">
                <span className="flex flex-col items-center gap-[1px]">
                  <span>{c.name}</span>
                  {a > 0.004 && a < 0.995 && !show && <span className="pct" data-v={Math.round(a * 100)} />}
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const RangeCells = memo(RangeCellsInner);
