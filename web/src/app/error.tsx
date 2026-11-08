"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/lib/settings";

/** Route-level error boundary: an exception in any screen shows this inside the app shell instead of a blank page. */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section role="alert" data-testid="route-error" className="mx-auto max-w-md space-y-4 py-10 text-center">
      <h1 className="text-2xl font-extrabold">{t("err.title")}</h1>
      <p className="text-muted">{t("err.body")}</p>
      <div className="grid gap-2">
        <button type="button" onClick={() => retry()} className="min-h-12 rounded-2xl bg-accent font-bold text-accent-ink">
          {t("err.retry")}
        </button>
        <Link href="/" className="grid min-h-12 place-items-center rounded-2xl border border-line font-bold">
          {t("err.home")}
        </Link>
      </div>
      <details className="text-left text-xs text-muted">
        <summary className="min-h-11 cursor-pointer py-3">{t("err.detail")}</summary>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-surface p-3">{msg}</pre>
      </details>
    </section>
  );
}
