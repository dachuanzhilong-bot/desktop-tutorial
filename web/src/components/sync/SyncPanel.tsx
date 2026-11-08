"use client";
import { useState } from "react";
import { useSettings } from "@/lib/settings";
import { useSync } from "./SyncProvider";

/** account + cloud sync section (Settings) */
export function SyncPanel() {
  const { t } = useSettings();
  const sync = useSync();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 block min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink";
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label={t("sync.title")} data-testid="sync-panel">
      <h2 className="font-bold">{t("sync.title")}</h2>
      {!sync.configured ? (
        <p className="text-sm text-muted" data-testid="sync-off">
          {t("sync.notConfigured")}
        </p>
      ) : sync.email ? (
        <div className="space-y-2">
          <p className="font-semibold" data-testid="sync-user">
            {t("sync.signedIn", { email: sync.email })}
          </p>
          <p className="text-sm text-muted" role="status">
            {sync.status === "syncing" ? t("sync.syncing") : sync.lastSync ? t("sync.last", { time: new Date(sync.lastSync).toLocaleString() }) : t("sync.never")}
            {sync.report && sync.status === "idle" ? ` · ${t("sync.result", { up: sync.report.pushedAttempts + sync.report.pushedSrs + sync.report.pushedRanges, down: sync.report.pulledAttempts + sync.report.pulledSrs + sync.report.pulledRanges })}` : ""}
            {sync.report?.settings === "pulled" ? ` · ${t("sync.settingsPulled")}` : ""}
          </p>
          {sync.error && (
            <p role="alert" className="text-sm text-[color:var(--g-blunder)]">
              {sync.error === "auth" ? t("sync.authError") : t("sync.error", { msg: sync.error })}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => void sync.syncNow()} disabled={sync.status === "syncing"} className="min-h-11 flex-1 rounded-xl bg-accent font-bold text-accent-ink disabled:opacity-50">
              {t("sync.now")}
            </button>
            <button type="button" onClick={() => void sync.signOut()} className="min-h-11 flex-1 rounded-xl border border-line font-semibold">
              {t("sync.logout")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t("sync.intro")}</p>
          {sync.error === "auth" && <p className="text-sm text-[color:var(--g-blunder)]">{t("sync.authError")}</p>}
          <label className="block text-sm text-muted">
            {t("sync.email")}
            <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} data-testid="sync-email" />
          </label>
          <button type="button" disabled={busy || !/.+@.+\..+/.test(email)} data-testid="sync-send" onClick={() => run(async () => (await sync.sendCode(email.trim()), setSentTo(email.trim())))} className="min-h-11 w-full rounded-xl border border-accent font-bold text-accent-text disabled:opacity-50">
            {t("sync.sendCode")}
          </button>
          {sentTo && (
            <>
              <p className="text-sm" role="status">
                {t("sync.codeSent", { email: sentTo })}
              </p>
              <label className="block text-sm text-muted">
                {t("sync.code")}
                <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className={input} data-testid="sync-code" />
              </label>
              <button type="button" disabled={busy || code.trim().length < 6} data-testid="sync-verify" onClick={() => run(() => sync.verify(sentTo, code))} className="min-h-11 w-full rounded-xl bg-accent font-bold text-accent-ink disabled:opacity-50">
                {t("sync.login")}
              </button>
            </>
          )}
          {msg && (
            <p role="alert" className="text-sm text-[color:var(--g-blunder)]">
              {msg}
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted">{t("sync.scope")}</p>
    </section>
  );
}
