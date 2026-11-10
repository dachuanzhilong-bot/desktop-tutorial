"use client";
import Link from "next/link";
import { useState } from "react";
import { StudyTabs } from "@/components/StudyTabs";
import { Skeleton } from "@/components/Skeleton";
import { useSettings } from "@/lib/settings";
import { NOTE_MAX } from "@/lib/storage/bookmarks";
import type { Bookmark } from "@/lib/storage/bookmarks";
import { useBookmarks } from "@/lib/storage/useBookmarks";
import { selectSavedPositions } from "@/lib/study/savedPositions";
import type { SavedPositionSort } from "@/lib/study/savedPositions";

function Item({ b, onNote, onDelete }: { b: Bookmark; onNote: (b: Bookmark, note: string) => void; onDelete: (id: string) => void }) {
  const { t, settings } = useSettings();
  const [note, setNote] = useState(b.note);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState("");
  const date = new Date(b.ts).toLocaleDateString(settings.lang === "en" ? "en-US" : "ja-JP");
  return (
    <li className="space-y-2 rounded-card border border-line bg-surface p-3" data-testid="saved-item">
      <div>
        <h2 className="font-bold" data-testid="saved-title">
          {b.title}
        </h2>
        <p className="text-xs text-muted">{t("saved.date", { d: date })}</p>
      </div>
      <label className="block text-xs text-muted">
        {t("saved.note")}
        <textarea
          value={note}
          maxLength={NOTE_MAX}
          rows={2}
          placeholder={t("saved.notePh")}
          data-testid="saved-note"
          onChange={(e) => {
            setNote(e.target.value);
            setStatus("");
          }}
          // saved when the field is left, not on every key
          onBlur={() => {
            if (note !== b.note) {
              onNote(b, note);
              setStatus(t("saved.noteSaved"));
            }
          }}
          className="mt-0.5 block w-full rounded-control border border-line bg-surface-2 px-3 py-2 text-base text-ink"
        />
      </label>
      <p role="status" className="min-h-4 text-xs text-accent-text">
        {status}
      </p>
      <div className="flex items-center gap-2">
        <Link href={b.href} data-testid="saved-open" className="inline-grid min-h-tap-lg flex-1 place-items-center rounded-control bg-accent px-4 font-bold text-accent-ink">
          {t("saved.open")}
        </Link>
        {confirm ? (
          <>
            <span className="text-sm font-semibold">{t("saved.confirm")}</span>
            <button type="button" data-testid="saved-delete-yes" onClick={() => onDelete(b.id)} className="min-h-tap-lg rounded-control border border-line px-3 font-bold">
              {t("saved.yes")}
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="min-h-tap-lg rounded-control border border-line px-3 font-semibold">
              {t("saved.no")}
            </button>
          </>
        ) : (
          <button type="button" data-testid="saved-delete" onClick={() => setConfirm(true)} className="min-h-tap-lg rounded-control border border-line px-4 font-semibold">
            {t("saved.delete")}
          </button>
        )}
      </div>
    </li>
  );
}

export default function SavedPage() {
  const { t } = useSettings();
  const { list, failed, setNote, remove } = useBookmarks();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SavedPositionSort>("newest");
  const visible = list ? selectSavedPositions(list, query, sort) : [];
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">{t("study.title")}</h1>
        <p className="text-sm text-muted">{t("saved.subtitle")}</p>
      </header>
      <StudyTabs />
      {failed && (
        <p role="alert" className="rounded-control border border-line bg-surface-2 p-2 text-sm font-semibold">
          {t("saved.failed")}
        </p>
      )}
      {list === null ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-card border border-dashed border-line p-6 text-center" data-testid="saved-empty">
          <p className="text-muted">{t("saved.empty")}</p>
          <Link href="/study/" className="mt-3 inline-grid min-h-tap-lg place-items-center rounded-control bg-accent px-6 font-bold text-accent-ink">
            {t("saved.goStudy")}
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm font-semibold text-muted" data-testid="saved-count">
            {t("saved.title")} · {t("saved.count", { shown: visible.length, total: list.length })}
          </p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,auto)]">
            <label className="block text-sm font-semibold">
              {t("saved.search")}
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("saved.searchPh")}
                data-testid="saved-search"
                className="mt-1 block min-h-tap-lg w-full rounded-control border border-line bg-surface-2 px-3 py-2 text-base font-normal text-ink"
              />
            </label>
            <label className="block text-sm font-semibold">
              {t("saved.sort")}
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SavedPositionSort)}
                data-testid="saved-sort"
                className="mt-1 block min-h-tap-lg w-full rounded-control border border-line bg-surface-2 px-3 py-2 text-base font-normal text-ink"
              >
                <option value="newest">{t("saved.newest")}</option>
                <option value="oldest">{t("saved.oldest")}</option>
              </select>
            </label>
          </div>
          {visible.length === 0 ? (
            <p role="status" className="rounded-control border border-dashed border-line p-4 text-center text-sm text-muted" data-testid="saved-no-results">
              {t("saved.noMatches")}
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((b) => (
                <Item key={b.id} b={b} onNote={setNote} onDelete={remove} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
