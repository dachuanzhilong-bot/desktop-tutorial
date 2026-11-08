"use client";
import type { ReactNode } from "react";
import { useSettings } from "@/lib/settings";
import { useSolutionStore } from "@/lib/solution/context";
import type { SolutionStore } from "@/lib/solution/loader";
import { GridSkeleton, Skeleton } from "./Skeleton";

/** Renders children once the solution manifest is available (skeleton while loading, retry on error). */
export function SolutionGate({ children, grid = true }: { children: (store: SolutionStore) => ReactNode; grid?: boolean }) {
  const { store, error, retry } = useSolutionStore();
  const { t } = useSettings();
  if (store) return <>{children(store)}</>;
  if (error)
    return (
      <div role="alert" className="rounded-2xl border border-line bg-surface p-5">
        <p className="font-bold">{t("common.error")}</p>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <button type="button" onClick={retry} className="mt-3 min-h-11 rounded-xl bg-accent px-4 font-bold text-accent-ink">
          {t("common.retry")}
        </button>
      </div>
    );
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-10 w-2/3" />
      {grid ? <GridSkeleton /> : <Skeleton className="h-40 w-full" />}
    </div>
  );
}
