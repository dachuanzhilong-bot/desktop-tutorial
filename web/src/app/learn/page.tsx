"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StudyTabs } from "@/components/StudyTabs";
import { LESSONS, lessonById, lessonText } from "@/lib/learn/lessons";
import type { Lesson } from "@/lib/learn/lessons";
import { useSettings } from "@/lib/settings";
import { useLessons } from "@/lib/storage/useLessons";

function Progress({ done, n, label }: { done: number; n: number; label: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-muted" data-testid="learn-progress">
        {label}
      </p>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={done} aria-label={label}>
        <div className="h-full bg-accent" style={{ width: `${n ? (done / n) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

export default function LearnPage() {
  const { t, settings } = useSettings();
  const { done, failed, toggle } = useLessons();
  const [openId, setOpenId] = useState<string | null>(null);
  const lang = settings.lang;

  // a link such as /learn/#potodds opens that lesson; the hash is only known in the browser, after hydration
  useEffect(() => {
    const read = () => {
      const id = location.hash.replace(/^#/, "");
      setOpenId(lessonById(id) ? id : null);
    };
    read(); // the URL hash once, then its changes
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const open = (id: string | null) => {
    setOpenId(id);
    // the address follows a tap (it is never written right after the page loads)
    try {
      history.replaceState(null, "", `${location.pathname}${id ? `#${id}` : ""}`);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 });
  };

  const lesson: Lesson | undefined = openId ? lessonById(openId) : undefined;
  const doneCount = done ? LESSONS.filter((l) => done.has(l.id)).length : 0;

  const header = (
    <>
      <header>
        <h1 className="text-2xl font-extrabold">{t("learn.title")}</h1>
        <p className="text-sm text-muted">{t("learn.subtitle")}</p>
      </header>
      <StudyTabs />
    </>
  );

  if (lesson) {
    const text = lessonText(lesson, lang);
    const isDone = !!done?.has(lesson.id);
    const next = LESSONS[LESSONS.findIndex((l) => l.id === lesson.id) + 1]; // the lesson after this one, in the order of the path
    return (
      <div className="space-y-4">
        {header}
        <article className="space-y-4 rounded-card border border-line bg-surface p-4" data-testid="lesson" aria-labelledby="lesson-title">
          <button type="button" onClick={() => open(null)} data-testid="lesson-back" className="min-h-tap rounded-control border border-line px-3 text-sm font-semibold">
            ← {t("learn.back")}
          </button>
          <div>
            <h2 id="lesson-title" className="text-xl font-extrabold">
              {text.title}
            </h2>
            <p className="text-xs text-muted">{t("learn.minutes", { n: lesson.minutes })}</p>
            <p className="mt-2">{text.lead}</p>
          </div>
          <section aria-label={t("learn.points")}>
            <h3 className="mb-1 text-sm font-bold text-muted">{t("learn.points")}</h3>
            <ul className="list-disc space-y-2 pl-5 leading-relaxed">
              {text.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
          <section aria-label={t("learn.why")} className="rounded-control bg-surface-2 p-3">
            <h3 className="text-sm font-bold">{t("learn.why")}</h3>
            <p className="mt-1 text-sm leading-relaxed">{text.why}</p>
          </section>
          <p className="text-xs text-muted">{t("learn.approx")}</p>
          <section aria-label={t("learn.try")} className="space-y-2">
            <h3 className="text-sm font-bold text-muted">{t("learn.try")}</h3>
            {lesson.tries.map((x) => (
              <Link key={x.href} href={x.href} data-testid="lesson-try" className="flex min-h-tap-lg items-center justify-between gap-2 rounded-control border border-accent px-4 font-bold text-accent-text">
                <span>{lang === "en" ? x.en : x.ja}</span>
                <span aria-hidden>›</span>
              </Link>
            ))}
          </section>
          <button
            type="button"
            aria-pressed={isDone}
            data-testid="lesson-done"
            disabled={done === null}
            onClick={() => void toggle(lesson.id, !isDone)}
            className={`min-h-tap-lg w-full rounded-control px-4 font-bold ${isDone ? "border border-accent bg-accent/15 text-accent-text" : "bg-accent text-accent-ink"}`}
          >
            {isDone ? `✓ ${t("learn.isDone")}` : t("learn.markDone")}
          </button>
          {failed && (
            <p role="alert" className="text-sm font-semibold">
              {t("learn.failed")}
            </p>
          )}
          {next && (
            <button type="button" onClick={() => open(next.id)} data-testid="lesson-next" className="min-h-tap-lg w-full rounded-control border border-line px-4 font-semibold">
              {t("learn.next")}: {lessonText(next, lang).title} ›
            </button>
          )}
        </article>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      <Progress done={doneCount} n={LESSONS.length} label={t("learn.progress", { done: doneCount, n: LESSONS.length })} />
      {done && doneCount === LESSONS.length && <p className="rounded-control bg-surface-2 p-3 text-sm font-semibold">{t("learn.allDone")}</p>}
      <ol className="space-y-2" data-testid="lesson-list">
        {LESSONS.map((l, i) => {
          const text = lessonText(l, lang);
          const isDone = !!done?.has(l.id);
          return (
            <li key={l.id}>
              <button
                type="button"
                data-testid={`lesson-${l.id}`}
                onClick={() => open(l.id)}
                className="flex min-h-tap-lg w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left"
              >
                <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-bold ${isDone ? "border-accent bg-accent text-accent-ink" : "border-line text-muted"}`}>
                  {isDone ? "✓" : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{text.title}</span>
                  <span className="block text-sm text-muted">{text.lead}</span>
                  <span className="mt-0.5 block text-xs text-muted">{t("learn.minutes", { n: l.minutes })}{isDone ? ` · ${t("learn.doneShort")}` : ""}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
