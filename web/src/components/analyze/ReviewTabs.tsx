"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSettings } from "@/lib/settings";

const TABS = [
  { href: "/stats/", key: "analyze.tab.stats" },
  { href: "/analyze/", key: "analyze.tab.hands" },
] as const;

/** practice stats / imported hand histories */
export function ReviewTabs() {
  const path = usePathname() ?? "";
  const { t } = useSettings();
  const norm = (p: string) => (p.endsWith("/") ? p : p + "/");
  return (
    <nav aria-label="Review" className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1">
      {TABS.map((tab) => {
        const active = norm(path) === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`grid min-h-11 place-items-center rounded-xl text-sm font-bold transition-colors ${active ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
