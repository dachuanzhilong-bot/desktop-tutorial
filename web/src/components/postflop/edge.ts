"use client";
import { useCallback } from "react";
import type { Tone } from "@/components/RangeGrid";
import { useSettings } from "@/lib/settings";
import type { EdgeLabel } from "@/lib/postflop/replay";

export function edgeTone(l: EdgeLabel): Tone {
  switch (l.key) {
    case "fold":
      return "fold";
    case "check":
    case "call":
      return "call";
    case "allin":
      return "allin";
    case "raise":
      return "raise2";
    default:
      return l.pct >= 0.6 ? "raise2" : "raise1";
  }
}

/** localised text of an action edge, e.g. "ベット 75%" */
export function useEdgeText() {
  const { t } = useSettings();
  return useCallback(
    (l: EdgeLabel) => {
      const name = l.key === "fold" ? t("act.fold") : l.key === "check" ? t("act.check") : l.key === "call" ? t("act.call") : l.key === "allin" ? t("act.allin") : l.key === "raise" ? t("pf.raise") : t("pf.bet");
      if (l.key === "bet" || l.key === "raise") return `${name} ${Math.round(l.pct * 100)}%`;
      return name;
    },
    [t],
  );
}
