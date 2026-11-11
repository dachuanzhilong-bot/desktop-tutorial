"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/settings";
import { watchForUpdate } from "@/lib/pwa/updateWatch";

/** "A new version is in": shown when the service worker has swapped in newer files under a page that is still running the old ones. */
export function UpdateBanner() {
  const t = useT();
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    return watchForUpdate(navigator.serviceWorker, () => setAvailable(true));
  }, []);

  if (!available || dismissed) return null;
  return (
    <div role="status" data-testid="update-banner" className="mb-3 flex flex-wrap items-center gap-2 rounded-control border border-accent bg-surface px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">{t("update.banner")}</span>
      <button type="button" data-testid="update-reload" onClick={() => window.location.reload()} className="min-h-tap rounded-control bg-accent px-4 font-bold text-accent-ink">
        {t("update.reload")}
      </button>
      <button type="button" data-testid="update-later" onClick={() => setDismissed(true)} className="min-h-tap rounded-control border border-line px-3 font-semibold text-muted">
        {t("update.later")}
      </button>
    </div>
  );
}
