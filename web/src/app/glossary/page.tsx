"use client";
import { useMemo, useState } from "react";
import { GLOSSARY_IDS } from "@/components/Term";
import { useSettings } from "@/lib/settings";
import type { Key } from "@/lib/i18n/ja";

export default function GlossaryPage() {
  const { t } = useSettings();
  const [q, setQ] = useState("");
  const items = useMemo(
    () =>
      GLOSSARY_IDS.map((id) => ({ id, title: t(`gl.${id}.t` as Key), desc: t(`gl.${id}.d` as Key) })).filter((x) => !q || (x.title + x.desc).toLowerCase().includes(q.toLowerCase())),
    [q, t],
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{t("gl.title")}</h1>
      <label className="block">
        <span className="sr-only">{t("gl.search")}</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("gl.search")} className="min-h-12 w-full rounded-xl border border-line bg-surface px-4" />
      </label>
      <dl className="space-y-2">
        {items.map((x) => (
          <div key={x.id} className="rounded-2xl border border-line bg-surface p-4">
            <dt className="font-bold">{x.title}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted">{x.desc}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
