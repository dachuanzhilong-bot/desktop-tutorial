"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSettings } from "@/lib/settings";

const TABS = [
  { href: "/solve/", key: "solve.tab.solve" },
  { href: "/builder/", key: "solve.tab.builder" },
  { href: "/icm/", key: "solve.tab.icm" },
  { href: "/equity/", key: "solve.tab.equity" },
  { href: "/odds/", key: "solve.tab.odds" },
] as const;

/** Solve / Range builder switcher */
export function SolveTabs() {
  const path = usePathname() ?? "";
  const { t } = useSettings();
  const norm = (p: string) => (p.endsWith("/") ? p : p + "/");
  return (
    <nav aria-label="Solve" className="no-scrollbar mb-3 flex gap-1 overflow-x-auto rounded-card bg-surface p-1">
      {TABS.map((tab) => {
        const active = norm(path) === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`grid min-h-tap flex-1 shrink-0 place-items-center whitespace-nowrap rounded-control px-3 text-sm font-bold transition-colors ${active ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
