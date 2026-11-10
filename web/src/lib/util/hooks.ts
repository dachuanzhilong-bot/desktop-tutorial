"use client";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { newId } from "./id";

/**
 * A ref that always holds the latest value, for callbacks and timers that must not re-subscribe on every render.
 * The ref is updated after render (layout effect), never during it.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

// ---- current time, shared by all components and refreshed once a minute ----

let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeNow(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** "now" (epoch ms) for date-dependent views such as "today" and streaks: 0 while rendering the static HTML */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => (now ||= Date.now()),
    () => 0,
  );
}

// ---- location.hash as state ----

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/** the URL hash without "#" (deep links such as #d=40&n=12); "" while rendering the static HTML */
export function useHash(): string {
  return useSyncExternalStore(
    subscribeHash,
    () => location.hash.replace(/^#/, ""),
    () => "",
  );
}

/** a unique-enough id for a practice session, made on first use (not during render) */
export function sessionIdOf(ref: { current: string }, prefix: string): string {
  if (!ref.current) ref.current = newId(`${prefix}-`);
  return ref.current;
}
