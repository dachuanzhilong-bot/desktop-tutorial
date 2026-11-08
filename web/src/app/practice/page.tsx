"use client";
import { useEffect, useState } from "react";
import { useImmersive } from "@/components/ShellContext";
import { SolutionGate } from "@/components/SolutionGate";
import { Session } from "@/components/practice/Session";
import { Setup } from "@/components/practice/Setup";
import type { PracticeConfig } from "@/components/practice/types";
import type { PracticeFilter } from "@/lib/practice/sampler";
import { SPOT_TYPES, SpotType } from "@/lib/solution/types";

/** `/practice/#seat=3&spot=vs3bet` pre-fills the conditions (used by the weak-spot shortcuts) */
function parseHash(): Partial<PracticeFilter> {
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  const out: Partial<PracticeFilter> = {};
  const seat = p.get("seat");
  if (seat !== null && /^[0-5]$/.test(seat)) out.seats = [Number(seat)];
  const spot = p.get("spot");
  if (spot && (SPOT_TYPES as string[]).includes(spot)) out.spots = [spot as SpotType];
  return out;
}

export default function PracticePage() {
  const [config, setConfig] = useState<PracticeConfig | null>(null);
  const [run, setRun] = useState(0);
  const [initial, setInitial] = useState<Partial<PracticeFilter> | null>(null);
  useImmersive(config !== null);
  useEffect(() => setInitial(parseHash()), []);

  return (
    <SolutionGate grid={false}>
      {(store) =>
        config ? (
          <Session
            key={run}
            store={store}
            config={config}
            onExit={() => {
              setConfig(null);
              setRun((r) => r + 1);
            }}
          />
        ) : initial ? (
          <Setup initial={initial} onStart={(c) => setConfig(c)} />
        ) : null
      }
    </SolutionGate>
  );
}
