"use client";
import { useSettings } from "@/lib/settings";
import { promptInstall, snoozeInstall, useInstallMode } from "@/lib/util/install";

/** "Add to home screen" on the home screen: one tap on Android / Chrome, the share-menu steps on iOS Safari */
export function InstallCard() {
  const { t } = useSettings();
  const mode = useInstallMode();
  if (!mode) return null;
  return (
    <section className="rounded-card border border-accent/60 bg-surface p-4" aria-label={t("install.title")} data-testid="install-card">
      <h2 className="font-bold">{t("install.title")}</h2>
      <p className="mt-1 text-sm text-muted">{mode === "prompt" ? t("install.desc") : t("install.ios")}</p>
      <div className="mt-3 flex gap-2">
        {mode === "prompt" && (
          <button type="button" data-testid="install-go" onClick={() => void promptInstall()} className="min-h-tap-lg flex-[2] rounded-control bg-accent px-4 font-bold text-accent-ink">
            {t("install.go")}
          </button>
        )}
        <button type="button" data-testid="install-later" onClick={snoozeInstall} className="min-h-tap-lg flex-1 rounded-control border border-line px-4 font-semibold">
          {t("install.later")}
        </button>
      </div>
    </section>
  );
}
