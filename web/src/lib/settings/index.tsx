"use client";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { en } from "../i18n/en";
import { ja, Key } from "../i18n/ja";
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
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: "ja",
  theme: "dark",
  palette: "standard",
  pattern: false,
  labels: true,
  deck4: true,
  textScale: 1,
  haptics: true,
  dailyGoal: 30,
  onboarded: false,
};

export const STORAGE_KEY = "tessera.settings.v1";

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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch {
      /* private mode etc. – keep defaults */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyToDocument(settings);
    setHapticsEnabled(settings.haptics);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings, ready]);

  // follow the OS theme while the preference is "system"
  useEffect(() => {
    if (settings.theme !== "system" || typeof matchMedia === "undefined") return;
    const mq = matchMedia("(prefers-color-scheme: light)");
    const on = () => applyToDocument(settings);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [settings]);

  const set = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const t = useCallback<TFn>((key, params) => translate(settings.lang, key, params), [settings.lang]);
  const value = useMemo(() => ({ settings, set, t, ready }), [settings, set, t, ready]);
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
export const THEME_INIT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'{}');var e=document.documentElement;var th=s.theme||'dark';if(th==='system')th=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';e.dataset.theme=th;e.dataset.palette=s.palette||'standard';e.dataset.pattern=s.pattern?'on':'off';e.dataset.labels=s.labels===false?'off':'on';e.style.setProperty('--text-scale',String(s.textScale||1));if(s.lang)e.lang=s.lang;}catch(_){}})();`;
