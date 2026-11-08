"use client";
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
          <ShellProvider>{children}</ShellProvider>
        </SyncProvider>
      </SolutionProvider>
    </SettingsProvider>
  );
}
