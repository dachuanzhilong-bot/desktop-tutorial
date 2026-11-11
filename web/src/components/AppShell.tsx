"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useRef } from "react";
import type { Key } from "@/lib/i18n/ja";
import { useSettings } from "@/lib/settings";
import { withBase } from "@/lib/util/base";
import { IconBolt, IconChart, IconGear, IconGrid, IconHome, IconTarget } from "./icons";
import { CrashProbe } from "./CrashProbe";
import { OfflineBanner } from "./OfflineBanner";
import { Onboarding } from "./Onboarding";
import { useShell } from "./ShellContext";

const NAV = [
  { href: "/", key: "nav.home", Icon: IconHome },
  { href: "/study/", key: "nav.study", Icon: IconGrid },
  { href: "/practice/", key: "nav.practice", Icon: IconTarget },
  { href: "/solve/", key: "nav.solve", Icon: IconBolt, also: ["/builder", "/icm", "/equity", "/odds"] },
  { href: "/stats/", key: "nav.stats", Icon: IconChart, also: ["/analyze"] },
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
    navigator.serviceWorker.register(withBase("/sw.js")).catch(() => {});
  }, []);

  const isActive = (href: string, also: string[] = []) => (href === "/" ? path === "/" : [href, ...also].some((h) => path.startsWith(h.replace(/\/$/, ""))));

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col lg:max-w-7xl lg:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
        {t("common.skipToContent")}
      </a>
      <main id="main" className={`min-w-0 flex-1 px-4 pt-4 sm:pt-6 lg:px-8 lg:pb-10 ${immersive ? "pb-6" : "pb-28"}`} data-ready={ready}>
        {/* readable width on large screens; the Study chart uses the full width for its two columns */}
        <div className={path === "/study/" ? "" : "mx-auto w-full max-w-3xl"}>
          <OfflineBanner />
          {children}
        </div>
      </main>
      <nav
        aria-label="Primary"
        hidden={immersive}
        className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:sticky lg:top-0 lg:order-first lg:h-dvh lg:w-52 lg:shrink-0 lg:border-r lg:border-t-0 lg:bg-transparent lg:pt-6 lg:backdrop-blur-none"
      >
        <ul className="mx-auto flex max-w-3xl lg:flex-col lg:gap-1 lg:px-3">
          {NAV.map(({ href, key, Icon, also }) => {
            const active = isActive(href, also);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[0.72rem] font-semibold transition-colors lg:min-h-tap-lg lg:flex-row lg:justify-start lg:gap-3 lg:rounded-control lg:px-2 lg:text-sm ${active ? "text-accent-text lg:bg-accent/15" : "text-muted hover:text-ink lg:hover:bg-surface"}`}
                >
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors lg:w-8 ${active ? "bg-accent/20 lg:bg-transparent" : ""}`}>
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
      <CrashProbe tag="root" />
    </div>
  );
}
