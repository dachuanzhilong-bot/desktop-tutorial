import type { MetadataRoute } from "next";
import { withBase } from "@/lib/util/base";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tessera – Poker GTO",
    short_name: "Tessera",
    description: "Study, practice and analyse poker GTO strategies. Works offline.",
    start_url: withBase("/"),
    scope: withBase("/"),
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1311",
    theme_color: "#0b1311",
    lang: "ja",
    categories: ["education", "games"],
    icons: [
      { src: withBase("/icons/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: withBase("/icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: withBase("/icons/icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: withBase("/icons/icon.svg"), sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Practice", url: withBase("/practice/"), description: "Start a drill" },
      { name: "Study", url: withBase("/study/"), description: "Browse solutions" },
    ],
  };
}
