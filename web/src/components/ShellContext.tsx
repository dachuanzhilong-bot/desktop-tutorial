"use client";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

const Ctx = createContext<{ immersive: boolean; setImmersive: (v: boolean) => void }>({ immersive: false, setImmersive: () => {} });

export function ShellProvider({ children }: { children: ReactNode }) {
  const [immersive, setImmersive] = useState(false);
  return <Ctx.Provider value={{ immersive, setImmersive }}>{children}</Ctx.Provider>;
}

/** hide the bottom navigation while a practice session is running (more room, fewer mis-taps) */
export function useImmersive(on: boolean) {
  const { setImmersive } = useContext(Ctx);
  useEffect(() => {
    setImmersive(on);
    return () => setImmersive(false);
  }, [on, setImmersive]);
}

export const useShell = () => useContext(Ctx);
