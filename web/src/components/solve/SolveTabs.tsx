"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSettings } from "@/lib/settings";

const TABS = [
  { href: "/solve/", key: "solve.tab.solve" },
  { href: "/builder/", key: "solve.tab.builder" },
  { href: "/icm/", key: "solve.tab.icm" },
] as const;

/** Solve / Range builder switcher */
export function SolveTabs() {
  const path = usePathname() ?? "";
  const { t } = useSettings();
  const norm = (p: string) => (p.endsWith("/") ? p : p + "/");
  return (
    <nav aria-label="Solve" className="mb-3 grid grid-cols-3 gap-1 rounded-card bg-surface p-1">
      {TABS.map((tab) => {
        const active = norm(path) === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`grid min-h-tap place-items-center rounded-control text-sm font-bold transition-colors ${active ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
