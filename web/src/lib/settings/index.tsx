"use client";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { en } from "../i18n/en";
import { ja, Key } from "../i18n/ja";
import { DEPTHS, nearestDepth } from "../solution/loader";
import { bool, int, LocalSchema, num, pick, readLocal, upgrade, writeLocal } from "../storage/local";
import { BASE } from "../util/base";
import { setHapticsEnabled } from "../util/haptics";

export type Lang = "ja" | "en";
export type ThemePref = "dark" | "light" | "system";
export type Palette = "standard" | "cvd";

export interface Settings {
  lang: Lang;
  theme: ThemePref;
  palette: Palette;
  pattern: boolean;
  labels: boolean;
  deck4: boolean;
  textScale: number;
  haptics: boolean;
  dailyGoal: number;
  /** effective stack (bb) of the preflop solution shown in Study / Practice: 20, 40, 60, 100 or 200 */
  depth: number;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: "ja",
  theme: "dark",
  palette: "standard",
  pattern: true,
  labels: true,
  deck4: true,
  textScale: 1,
  haptics: true,
  dailyGoal: 30,
  depth: 100,
  onboarded: false,
};

/** the key keeps its historical name; the schema version lives in the stored object (`_v`, see storage/local.ts) */
export const STORAGE_KEY = "tessera.settings.v1";

export const TEXT_SCALES = [0.9, 1, 1.15, 1.3] as const;

/**
 * Settings schema history
 *   1: unversioned object (up to Phase 8)
 *   2: `_v` added, every field validated on read (unknown fields dropped, wrong types -> default)
 *   3: action patterns on the chart are on by default (actions must not be told apart by colour alone);
 *      the old default "off" is switched on once, the user can turn it off again
 */
export const SETTINGS_SCHEMA: LocalSchema<Settings> = {
  key: STORAGE_KEY,
  version: 3,
  migrations: { 1: (d) => d, 2: (d) => ({ ...d, pattern: true }) },
  sanitize: (d) => {
    const D = DEFAULT_SETTINGS;
    const depth = num(d.depth, D.depth, 1, 1000);
    return {
      lang: pick(d.lang, ["ja", "en"] as const, D.lang),
      theme: pick(d.theme, ["dark", "light", "system"] as const, D.theme),
      palette: pick(d.palette, ["standard", "cvd"] as const, D.palette),
      pattern: bool(d.pattern, D.pattern),
      labels: bool(d.labels, D.labels),
      deck4: bool(d.deck4, D.deck4),
      textScale: num(d.textScale, D.textScale, TEXT_SCALES[0], TEXT_SCALES[TEXT_SCALES.length - 1]),
      haptics: bool(d.haptics, D.haptics),
      dailyGoal: int(d.dailyGoal, D.dailyGoal, 1, 1000),
      depth: (DEPTHS as readonly number[]).includes(depth) ? depth : nearestDepth(depth),
      onboarded: bool(d.onboarded, D.onboarded),
    };
  },
};
/** epoch ms of the last change made on this device (0 = never): cloud sync uses it to pick the newer side */
export const UPDATED_KEY = "tessera.settings.updated";

const dicts: Record<Lang, Record<Key, string>> = { ja, en };

export function translate(lang: Lang, key: Key, params?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? dicts.ja[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

type TFn = (key: Key, params?: Record<string, string | number>) => string;

interface Ctx {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  /** settings that arrived from the cloud: applied without counting as a local change */
  applyRemote: (data: Record<string, unknown>, updated: number) => void;
  t: TFn;
  ready: boolean;
}

const SettingsContext = createContext<Ctx | null>(null);

export function resolveTheme(pref: ThemePref): "dark" | "light" {
  if (pref !== "system") return pref;
  if (typeof matchMedia === "undefined") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** reflect settings onto <html> so CSS can react (also done pre-paint by the inline script in layout) */
export function applyToDocument(s: Settings) {
  const el = document.documentElement;
  el.dataset.theme = resolveTheme(s.theme);
  el.dataset.palette = s.palette;
  el.dataset.pattern = s.pattern ? "on" : "off";
  el.dataset.labels = s.labels ? "on" : "off";
  el.style.setProperty("--text-scale", String(s.textScale));
  el.lang = s.lang;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // browser storage only exists after hydration (the static HTML is rendered with the defaults)
    const stored = readLocal(SETTINGS_SCHEMA);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load of browser-only state after hydration
    if (stored) setSettings(stored);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyToDocument(settings);
    setHapticsEnabled(settings.haptics);
    writeLocal(SETTINGS_SCHEMA, settings);
  }, [settings, ready]);

  // follow the OS theme while the preference is "system"
  useEffect(() => {
    if (settings.theme !== "system" || typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: light)");
    const on = () => applyToDocument(settings);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [settings]);

  const set = useCallback((patch: Partial<Settings>) => {
    try {
      localStorage.setItem(UPDATED_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setSettings((s) => ({ ...s, ...patch }));
  }, []);
  const applyRemote = useCallback((data: Record<string, unknown>, updated: number) => {
    try {
      localStorage.setItem(UPDATED_KEY, String(updated));
    } catch {
      /* ignore */
    }
    setSettings((s) => upgrade(SETTINGS_SCHEMA, { ...s, ...data }) ?? s);
  }, []);
  const t = useCallback<TFn>((key, params) => translate(settings.lang, key, params), [settings.lang]);
  const value = useMemo(() => ({ settings, set, applyRemote, t, ready }), [settings, set, applyRemote, t, ready]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const c = useContext(SettingsContext);
  if (!c) throw new Error("SettingsProvider missing");
  return c;
}

export function useT() {
  return useSettings().t;
}

/** inline script that runs before first paint to avoid a theme / text-size flash */
export const THEME_INIT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'{}');var e=document.documentElement;var th=s.theme||'dark';if(th==='system')th=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';e.dataset.theme=th;e.dataset.palette=s.palette||'standard';e.dataset.pattern=(s.pattern===false&&(s._v||1)>=3)?'off':'on';e.dataset.labels=s.labels===false?'off':'on';e.style.setProperty('--text-scale',String(s.textScale||1));if(s.lang)e.lang=s.lang;if(!s.onboarded&&location.pathname==='${BASE}/')e.dataset.tour='1';}catch(_){}})();`;
