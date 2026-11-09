"use client";
import Link from "next/link";
import { useT } from "@/lib/settings";

export function NotFoundView() {
  const t = useT();
  return (
    <section data-testid="not-found" className="mx-auto max-w-md space-y-4 py-10 text-center">
      <p className="text-5xl font-extrabold text-accent-text" aria-hidden>
        404
      </p>
      <h1 className="text-2xl font-extrabold">{t("nf.title")}</h1>
      <p className="text-muted">{t("nf.body")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Link href="/" className="grid min-h-tap-lg place-items-center rounded-card bg-accent font-bold text-accent-ink">
          {t("err.home")}
        </Link>
        <Link href="/practice/" className="grid min-h-tap-lg place-items-center rounded-card border border-line font-bold">
          {t("nav.practice")}
        </Link>
      </div>
    </section>
  );
}
