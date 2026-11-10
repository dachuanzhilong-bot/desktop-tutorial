import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/settings";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/AppShell";
import { withBase } from "@/lib/util/base";

export const metadata: Metadata = {
  title: { default: "Tessera – Poker GTO", template: "%s · Tessera" },
  description: "Study, practice and analyse poker GTO strategies. Works offline.",
  applicationName: "Tessera",
  manifest: withBase("/manifest.webmanifest"),
  appleWebApp: { capable: true, title: "Tessera", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: withBase("/icons/icon.svg"), type: "image/svg+xml" }, { url: withBase("/icons/icon-192.png"), sizes: "192x192", type: "image/png" }], apple: withBase("/icons/apple-touch-icon.png") },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b1311" },
    { media: "(prefers-color-scheme: light)", color: "#f4f7f5" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" data-theme="dark" data-palette="standard" data-pattern="on" data-labels="on" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
