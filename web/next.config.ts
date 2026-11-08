import type { NextConfig } from "next";

/**
 * Static export: the app is fully client-side (local-first), so it can be hosted on any
 * static host / CDN and works offline through the service worker (public/sw.js).
 */
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default config;
