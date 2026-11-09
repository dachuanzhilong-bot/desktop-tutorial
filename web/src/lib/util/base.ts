/**
 * Where the app is hosted. "" when it owns the whole origin (the default); "/desktop-tutorial" on a GitHub Pages
 * project site. Set by NEXT_PUBLIC_BASE_PATH at build time (see next.config.ts). Next's own <Link>, router and
 * /_next assets follow basePath by themselves; anything that names a file by hand (fetch, Worker, manifest) goes
 * through withBase().
 */
export const BASE: string = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

/** a root-relative path ("/solutions/…") on this host */
export const withBase = (path: string): string => `${BASE}${path}`;
