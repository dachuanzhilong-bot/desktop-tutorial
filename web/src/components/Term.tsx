"use client";
import { ReactNode, useId } from "react";
import { useT } from "@/lib/settings";
import type { Key } from "@/lib/i18n/ja";

/** Glossary tooltip (native popover: light dismiss, Esc, keyboard + screen reader friendly). */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const t = useT();
  const pid = useId();
  const title = t(`gl.${id}.t` as Key);
  const desc = t(`gl.${id}.d` as Key);
  return (
    <>
      <button
        type="button"
        popoverTarget={pid}
        className="cursor-help underline decoration-dotted decoration-muted underline-offset-4"
        aria-describedby={pid}
      >
        {children ?? title}
      </button>
      {/* spans only: Term is used inside <p> and table cells, where <div>/<p> would be invalid HTML (hydration error) */}
      <span id={pid} popover="auto" className="tip text-left font-normal" role="tooltip">
        <span className="mb-1 block font-bold">{title}</span>
        <span className="block text-sm leading-relaxed text-muted">{desc}</span>
      </span>
    </>
  );
}

export const GLOSSARY_IDS = ["approx", "ev", "evLoss", "gto", "equity", "eqr", "range", "mixed", "rfi", "3bet", "4bet", "squeeze", "limp", "ip", "blocker", "spr", "mdf", "exploit", "nodelock", "icm", "pushfold", "bubble", "cfr"];
