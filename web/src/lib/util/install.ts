"use client";
import { useSyncExternalStore } from "react";

/**
 * "Add to home screen". Android / desktop Chrome hands the page a `beforeinstallprompt` event that can open the
 * native install dialog from one tap; iOS Safari has no such API, so there the card only explains the share menu.
 */

/** Chrome's install event (not in the DOM typings) */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallMode = "prompt" | "ios" | null;

export interface InstallEnv {
  /** already running from the home screen */
  standalone: boolean;
  userAgent: string;
  maxTouchPoints: number;
  /** a saved `beforeinstallprompt` event is waiting */
  hasPrompt: boolean;
  /** the card was put away less than SNOOZE_DAYS ago */
  snoozed: boolean;
}

/** what the card should offer: the native dialog, the iOS steps, or nothing */
export function installMode(e: InstallEnv): InstallMode {
  if (e.standalone || e.snoozed) return null;
  if (e.hasPrompt) return "prompt";
  const ios = /iPhone|iPad|iPod/.test(e.userAgent) || (/Macintosh/.test(e.userAgent) && e.maxTouchPoints > 1);
  // iOS only lets Safari add to the home screen; other iOS browsers (Chrome, Firefox, in-app views) cannot
  const safari = /Safari\//.test(e.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|Line\/|FBAN|FBAV|Instagram/.test(e.userAgent);
  return ios && safari ? "ios" : null;
}

export const SNOOZE_KEY = "tessera.install.snoozed";
export const SNOOZE_DAYS = 14;

export const isSnoozed = (stored: string | null, now: number) => {
  const t = Number(stored);
  return Number.isFinite(t) && t > 0 && now - t < SNOOZE_DAYS * 86_400_000;
};

// ---- browser state, shared by every component ----
let promptEvent: InstallPromptEvent | null = null;
let snoozedAt: string | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  // registered when this module loads: the event can fire before any component has mounted
  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    promptEvent = ev as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    promptEvent = null;
    emit();
  });
  try {
    snoozedAt = localStorage.getItem(SNOOZE_KEY);
  } catch {
    /* private mode: the card just shows again next time */
  }
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

/** a string snapshot: React compares snapshots by value, so the mode itself is the snapshot */
function snapshot(): string {
  const standalone = installed || matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return String(
    installMode({ standalone, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, hasPrompt: !!promptEvent, snoozed: isSnoozed(snoozedAt, Date.now()) }),
  );
}

/** "prompt" | "ios" | null (null on the server and for the first client render, so the static HTML never shows the card) */
export function useInstallMode(): InstallMode {
  const s = useSyncExternalStore(subscribe, snapshot, () => "null");
  return s === "null" ? null : (s as InstallMode);
}

/** opens the native install dialog (one tap); resolves to whether the app was added */
export async function promptInstall(): Promise<boolean> {
  const ev = promptEvent;
  if (!ev) return false;
  promptEvent = null; // an event can be used once
  emit();
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === "accepted") {
      installed = true;
      emit();
    }
    return outcome === "accepted";
  } catch {
    return false;
  }
}

/** puts the card away for two weeks */
export function snoozeInstall() {
  snoozedAt = String(Date.now());
  try {
    localStorage.setItem(SNOOZE_KEY, snoozedAt);
  } catch {
    /* ignore */
  }
  emit();
}
