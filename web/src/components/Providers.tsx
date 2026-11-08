"use client";
import type { ReactNode } from "react";
import { SettingsProvider } from "@/lib/settings";
import { SolutionProvider } from "@/lib/solution/context";
import { ShellProvider } from "./ShellContext";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <SolutionProvider>
        <ShellProvider>{children}</ShellProvider>
      </SolutionProvider>
    </SettingsProvider>
  );
}
