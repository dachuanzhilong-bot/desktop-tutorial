"use client";
import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";
import { SettingsProvider } from "@/lib/settings";
import { SolutionProvider } from "@/lib/solution/context";
import { ShellProvider } from "./ShellContext";
import { SyncProvider } from "./sync/SyncProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <SolutionProvider>
        <SyncProvider>
          {/* every animation follows the OS "reduce motion" setting */}
          <MotionConfig reducedMotion="user">
            <ShellProvider>{children}</ShellProvider>
          </MotionConfig>
        </SyncProvider>
      </SolutionProvider>
    </SettingsProvider>
  );
}
