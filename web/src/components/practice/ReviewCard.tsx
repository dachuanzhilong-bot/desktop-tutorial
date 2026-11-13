"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { dueReview, REVIEW_SET_ID } from "@/lib/practice/review";
import type { PracticeSet } from "@/components/practice/types";
import type { ReviewGroup } from "@/lib/practice/review";
import { useSettings } from "@/lib/settings";
import { depthOf } from "@/lib/solution/catalog";
import { getRepo } from "@/lib/storage/idb";
import type { SrsItem } from "@/lib/practice/srs";
import { useNow } from "@/lib/util/hooks";

/**
 * "Today's review": the spaced-repetition items that are due, with a one-tap start. A round is a question list stored
 * under `practiceSet:review`, the same kind of list Analyze prepares, which the Practice screen starts at once.
 */
export function ReviewCard({ className = "", onStartSet }: { className?: string; onStartSet?: (s: PracticeSet) => void }) {
  const { t } = useSettings();
  const router = useRouter();
  const now = useNow();
  const [all, setAll] = useState<SrsItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getRepo()
      .allSrs()
      .then(setAll)
      .catch(() => setAll([]));
  }, []);
  const queue = useMemo(() => (all ? dueReview(all, now) : null), [all, now]);

  const start = async (g: ReviewGroup) => {
    const set: PracticeSet = { title: t("review.setTitle", { depth: depthOf(g.solution) }), solution: g.solution, items: g.items };
    try {
      // on the Practice screen itself the round starts right here (a change of the address hash alone is not read again there)
      if (onStartSet) return onStartSet(set);
      await getRepo().setMeta(`practiceSet:${REVIEW_SET_ID}`, set);
      router.push(`/practice/#set=${REVIEW_SET_ID}`);
    } catch {
      setFailed(true);
    }
  };

  if (!queue || queue.total === 0) return null;
  return (
    <section className={`rounded-card border border-accent/60 bg-surface p-4 ${className}`} aria-label={t("review.title")} data-testid="review-card">
      <h2 className="font-bold">{t("review.title")}</h2>
      <p className="mt-1 text-sm text-muted" data-testid="review-count">
        {t("review.desc", { n: queue.total })}
      </p>
      <div className="mt-3 space-y-2">
        {queue.groups.map((g, i) => (
          <button
            key={g.solution}
            type="button"
            data-testid={`review-go-${depthOf(g.solution)}`}
            onClick={() => void start(g)}
            className={`min-h-tap-lg w-full rounded-control px-4 font-bold ${i === 0 ? "bg-accent text-accent-ink" : "border border-line bg-surface-2"}`}
          >
            {queue.groups.length === 1 ? t("review.go", { n: g.due }) : t("review.goDepth", { depth: depthOf(g.solution), n: g.due })}
          </button>
        ))}
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm font-semibold">
          {t("review.failed")}
        </p>
      )}
    </section>
  );
}
