"use client";
import Link from "next/link";
import { useState } from "react";
import { TOUR_EVENT } from "@/components/Onboarding";
import { useSolutionStore } from "@/lib/solution/context";
import { Palette, ThemePref, useSettings } from "@/lib/settings";
import { getRepo } from "@/lib/storage/idb";
import type { Key } from "@/lib/i18n/ja";

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-2xl bg-surface-2 p-1">
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)} className={`min-h-11 flex-1 rounded-xl px-2 text-sm font-bold ${value === o.v ? "bg-accent text-accent-ink" : "text-muted"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
      <div>
        <p className="font-bold">{title}</p>
        {desc && <p className="text-xs text-muted">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-2"}`}>
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
    </button>
  );
}

export default function SettingsPage() {
  const { settings, set, t } = useSettings();
  const { store } = useSolutionStore();
  const [cleared, setCleared] = useState(false);
  const info = (store?.manifest.info ?? {}) as { solver?: string; iterations?: number; polish?: number; brGainMax?: number };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">{t("settings.title")}</h1>

      <Row title={t("settings.language")}>
        <Seg value={settings.lang} label={t("settings.language")} onChange={(v) => set({ lang: v })} options={[{ v: "ja", label: "日本語" }, { v: "en", label: "English" }]} />
      </Row>

      <Row title={t("settings.theme")}>
        <Seg<ThemePref>
          value={settings.theme}
          label={t("settings.theme")}
          onChange={(v) => set({ theme: v })}
          options={[
            { v: "dark", label: t("settings.theme.dark") },
            { v: "light", label: t("settings.theme.light") },
            { v: "system", label: t("settings.theme.system") },
          ]}
        />
      </Row>

      <Row title={t("settings.palette")}>
        <Seg<Palette>
          value={settings.palette}
          label={t("settings.palette")}
          onChange={(v) => set({ palette: v })}
          options={[
            { v: "standard", label: t("settings.palette.standard") },
            { v: "cvd", label: t("settings.palette.cvd") },
          ]}
        />
        <div className="flex gap-2" aria-hidden>
          {(["raise1", "call", "fold"] as const).map((k) => (
            <span key={k} className="seg h-8 flex-1 rounded-lg" data-k={k} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold">{t("settings.pattern")}</p>
            <p className="text-xs text-muted">{t("settings.patternDesc")}</p>
          </div>
          <Switch on={settings.pattern} onChange={(v) => set({ pattern: v })} label={t("settings.pattern")} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold">{t("settings.labels")}</p>
          <Switch on={settings.labels} onChange={(v) => set({ labels: v })} label={t("settings.labels")} />
        </div>
      </Row>

      <Row title={t("settings.deck")} desc={t("settings.deckDesc")}>
        <div className="flex items-center justify-between">
          <div className="card flex gap-1" data-deck={settings.deck4 ? "4" : "2"} aria-hidden>
            {(["s", "h", "d", "c"] as const).map((s) => (
              <span key={s} className="grid h-10 w-8 place-items-center rounded-md bg-white text-xl font-black" data-suit={s}>
                {{ s: "♠", h: "♥", d: "♦", c: "♣" }[s]}
              </span>
            ))}
          </div>
          <Switch on={settings.deck4} onChange={(v) => set({ deck4: v })} label={t("settings.deck")} />
        </div>
      </Row>

      <Row title={t("settings.textSize")}>
        <Seg<number>
          value={settings.textScale}
          label={t("settings.textSize")}
          onChange={(v) => set({ textScale: v })}
          options={[
            { v: 0.9, label: "A−" },
            { v: 1, label: "A" },
            { v: 1.15, label: "A+" },
            { v: 1.3, label: "A++" },
          ]}
        />
      </Row>

      <Row title={t("settings.haptics")}>
        <Switch on={settings.haptics} onChange={(v) => set({ haptics: v })} label={t("settings.haptics")} />
      </Row>

      <Row title={t("settings.dailyGoal")}>
        <Seg<number> value={settings.dailyGoal} label={t("settings.dailyGoal")} onChange={(v) => set({ dailyGoal: v })} options={[10, 20, 30, 50, 100].map((n) => ({ v: n, label: String(n) }))} />
      </Row>

      <Row title={t("settings.about")}>
        <p className="text-sm leading-relaxed text-muted">{t("settings.aboutText")}</p>
        <p className="text-sm leading-relaxed text-muted">
          <b className="text-ink">{t("settings.model")}</b>
          <br />
          {t("settings.modelText", { solver: info.solver ?? "–", iters: (info.iterations ?? 0) + (info.polish ?? 0), gap: info.brGainMax?.toFixed(4) ?? "–" })}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold">
            {t("settings.tour")}
          </button>
          <Link href="/glossary/" className="grid min-h-11 place-items-center rounded-xl border border-line px-4 text-sm font-semibold">
            {t("gl.title")}
          </Link>
          <Link href="/roadmap/" className="grid min-h-11 place-items-center rounded-xl border border-line px-4 text-sm font-semibold">
            {t("settings.roadmap")}
          </Link>
        </div>
      </Row>

      <Row title={t("settings.data")}>
        <button
          type="button"
          data-testid="clear-data"
          onClick={async () => {
            if (window.confirm(t("settings.clearConfirm"))) {
              await getRepo().clear();
              setCleared(true);
            }
          }}
          className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold text-[var(--g-blunder)]"
        >
          {t("settings.clear")}
        </button>
        {cleared && <p role="status" className="text-sm text-accent-text">{t("common.done")}</p>}
      </Row>
    </div>
  );
}
