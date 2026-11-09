"use client";
import { useEffect, useRef } from "react";
import { actionLabel, fmtBB, Step } from "@/lib/solution/tree";
import { ActionKind } from "@/lib/solution/types";
import { useSettings } from "@/lib/settings";

/** horizontally scrollable breadcrumb of the actions that lead to the current node */
export function LineBar({ steps, players, currentLabel, onJump }: { steps: Step[]; players: string[]; currentLabel: string; onJump: (nodeId: number) => void }) {
  const { t } = useSettings();
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.lastElementChild?.scrollIntoView({ inline: "end", block: "nearest" });
  }, [steps.length]);
  return (
    <nav aria-label={t("study.line")}>
      <ol ref={ref} className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <li>
          <button type="button" onClick={() => onJump(0)} className="min-h-tap whitespace-nowrap rounded-full border border-line bg-surface px-3 text-sm font-semibold text-muted hover:text-ink">
            {t("study.root")}
          </button>
        </li>
        {steps.map((s, i) => {
          const tone = s.action.kind === ActionKind.Fold ? "fold" : s.action.kind === ActionKind.Call ? "call" : s.after.level >= 3 ? "raise2" : "raise1";
          const lbl = actionLabel(s.action, s.actor, s.before, t);
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => onJump(s.node.id)}
                className="seg flex min-h-tap items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-bold text-white"
                data-k={tone}
              >
                <span>{players[s.actor]}</span>
                <span className="opacity-90">
                  {lbl}
                  {s.action.kind >= ActionKind.Raise || (s.action.kind === ActionKind.Call && s.before.level > 0) ? ` ${fmtBB(s.action.to)}` : ""}
                </span>
              </button>
            </li>
          );
        })}
        <li aria-current="step">
          <span className="flex min-h-tap items-center whitespace-nowrap rounded-full border-2 border-accent bg-surface px-3 text-sm font-extrabold text-accent-text">{currentLabel}</span>
        </li>
      </ol>
    </nav>
  );
}
