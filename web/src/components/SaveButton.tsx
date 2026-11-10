"use client";
import { useSettings } from "@/lib/settings";
import { useBookmarks } from "@/lib/storage/useBookmarks";
import { haptic } from "@/lib/util/haptics";

/** star button of the Study screens: saves the position being looked at (and takes it out again) */
export function SaveButton({ href, title }: { href: string; title: string }) {
  const { t } = useSettings();
  const { list, toggle } = useBookmarks();
  const on = !!list?.some((b) => b.href === href);
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={list === null}
      data-testid="save-position"
      onClick={() => {
        haptic.tap();
        void toggle(href, title);
      }}
      className={`inline-flex min-h-tap shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold ${on ? "border-accent bg-accent/15 text-accent-text" : "border-line bg-surface text-muted"}`}
    >
      <span aria-hidden>{on ? "★" : "☆"}</span>
      {on ? t("study.saved") : t("study.save")}
    </button>
  );
}
