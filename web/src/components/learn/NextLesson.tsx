"use client";
import Link from "next/link";
import { LESSONS, lessonText, nextLesson } from "@/lib/learn/lessons";
import { useSettings } from "@/lib/settings";
import { useLessons } from "@/lib/storage/useLessons";

/** home screen: the next lesson of the learning path and how far the path is */
export function NextLesson() {
  const { t, settings } = useSettings();
  const { done } = useLessons();
  if (!done) return null;
  const next = nextLesson(done);
  const count = LESSONS.filter((l) => done.has(l.id)).length;
  return (
    <Link
      href={next ? `/learn/#${next.id}` : "/learn/"}
      data-testid="next-lesson"
      className="flex min-h-tap-lg items-center justify-between gap-3 rounded-card border border-line bg-surface p-3"
    >
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-muted">
          {t("learn.title")} · {t("learn.progress", { done: count, n: LESSONS.length })}
        </span>
        <span className="block font-bold">{next ? t("learn.nextOf", { title: lessonText(next, settings.lang).title }) : t("learn.allDone")}</span>
      </span>
      <span aria-hidden className="text-lg text-muted">
        ›
      </span>
    </Link>
  );
}
