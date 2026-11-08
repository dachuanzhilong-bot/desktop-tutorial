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
      <div id={pid} popover="auto" className="tip" role="tooltip">
        <p className="mb-1 font-bold">{title}</p>
        <p className="text-sm leading-relaxed text-muted">{desc}</p>
      </div>
    </>
  );
}

export const GLOSSARY_IDS = ["ev", "evLoss", "gto", "equity", "eqr", "range", "mixed", "rfi", "3bet", "4bet", "squeeze", "limp", "ip", "blocker", "spr", "mdf", "exploit", "nodelock", "icm", "cfr"];
