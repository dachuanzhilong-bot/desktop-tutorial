"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useRef } from "react";
import type { Key } from "@/lib/i18n/ja";
import { useSettings } from "@/lib/settings";
import { IconBolt, IconChart, IconGear, IconGrid, IconHome, IconTarget } from "./icons";
import { Onboarding } from "./Onboarding";
import { useShell } from "./ShellContext";

const NAV = [
  { href: "/", key: "nav.home", Icon: IconHome },
  { href: "/study/", key: "nav.study", Icon: IconGrid },
  { href: "/practice/", key: "nav.practice", Icon: IconTarget },
  { href: "/solve/", key: "nav.solve", Icon: IconBolt, also: ["/builder"] },
  { href: "/stats/", key: "nav.stats", Icon: IconChart },
  { href: "/settings/", key: "nav.settings", Icon: IconGear },
] as readonly { href: string; key: Key; Icon: typeof IconHome; also?: string[] }[];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const { t, ready } = useSettings();
  const registered = useRef(false);
  const { immersive } = useShell();

  // offline support: the service worker is only registered in production builds
  useEffect(() => {
    if (registered.current || process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    registered.current = true;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const isActive = (href: string, also: string[] = []) => (href === "/" ? path === "/" : [href, ...also].some((h) => path.startsWith(h.replace(/\/$/, ""))));

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
        Skip to content
      </a>
      <main id="main" className={`flex-1 px-4 pt-4 sm:pt-6 ${immersive ? "pb-6" : "pb-28"}`} data-ready={ready}>
        {children}
      </main>
      <nav
        aria-label="Primary"
        hidden={immersive}
        className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      >
        <ul className="mx-auto flex max-w-3xl">
          {NAV.map(({ href, key, Icon, also }) => {
            const active = isActive(href, also);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold transition-colors ${active ? "text-accent-text" : "text-muted hover:text-ink"}`}
                >
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${active ? "bg-accent/20" : ""}`}>
                    <Icon width={22} height={22} />
                  </span>
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Onboarding />
    </div>
  );
}
