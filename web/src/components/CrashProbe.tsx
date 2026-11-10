"use client";
import { useEffect, useState } from "react";

/**
 * Test hook for the error boundaries. Only active in the e2e build (NEXT_PUBLIC_E2E=1, set by scripts/e2e.mjs):
 * opening a page with `#e2e-crash-<tag>` throws during render. In normal builds it renders nothing and never throws.
 */
export function CrashProbe({ tag }: { tag: string }) {
  const [crash, setCrash] = useState(false);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E !== "1") return;
    const check = () => setCrash(location.hash === `#e2e-crash-${tag}`);
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [tag]);
  if (crash) throw new Error(`e2e crash probe (${tag})`);
  return null;
}
