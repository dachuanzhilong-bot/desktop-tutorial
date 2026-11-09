"use client";
import type { ReactNode } from "react";
import { useT } from "@/lib/settings";
import { Term } from "./Term";

/**
 * "This is an approximation" notice, the same everywhere solution data is shown or used for grading.
 * The label is text (not a colour) and "what is this?" opens the glossary explanation in place.
 */
export function ApproxNote({ children, className = "", testId = "approx-note" }: { children: ReactNode; className?: string; testId?: string }) {
  const t = useT();
  return (
    <p className={`flex items-start gap-2 text-xs leading-relaxed text-muted ${className}`} data-testid={testId}>
      <span className="mt-px shrink-0 rounded border border-line px-1.5 font-bold text-ink">{t("approx.badge")}</span>
      <span>
        {children} <Term id="approx">{t("approx.more")}</Term>
      </span>
    </p>
  );
}
