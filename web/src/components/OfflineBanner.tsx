"use client";
import { useSyncExternalStore } from "react";
import { useT } from "@/lib/settings";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Thin notice while the device is offline (everything except cloud sync keeps working from local data). */
export function OfflineBanner() {
  const t = useT();
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <p role="status" data-testid="offline-banner" className="mb-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted">
      <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[color:var(--g-inaccurate)] align-middle" />
      {t("offline.banner")}
    </p>
  );
}
