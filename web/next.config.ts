import type { NextConfig } from "next";

/**
 * Static export: the app is fully client-side (local-first), so it can be hosted on any
 * static host / CDN and works offline through the service worker (public/sw.js).
 */
// A project site (https://<user>.github.io/<repo>/) needs a sub-path: NEXT_PUBLIC_BASE_PATH=/<repo>
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

const config: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default config;
