/** Thin wrapper around the Vibration API (not available on iOS Safari – silently ignored). */
let enabled = true;
export const setHapticsEnabled = (v: boolean) => {
  enabled = v;
};
export function vibrate(pattern: number | number[]) {
  if (!enabled || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
export const haptic = {
  tap: () => vibrate(8),
  good: () => vibrate(14),
  bad: () => vibrate([28, 40, 28]),
};
