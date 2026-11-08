"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSettings } from "@/lib/settings";

const TABS = [
  { href: "/study/", key: "pf.tab.pre" },
  { href: "/study/postflop/", key: "pf.tab.post" },
  { href: "/study/report/", key: "pf.tab.report" },
] as const;

/** Preflop / Postflop / Report switcher shown at the top of every Study page */
export function StudyTabs() {
  const path = usePathname() ?? "";
  const { t } = useSettings();
  const norm = (p: string) => (p.endsWith("/") ? p : p + "/");
  return (
    <nav aria-label="Study" className="mb-3 grid grid-cols-3 gap-1 rounded-2xl bg-surface p-1">
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
