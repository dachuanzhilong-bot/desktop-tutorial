"use client";
import { useEffect, useState } from "react";
import { useImmersive } from "@/components/ShellContext";
import { SolutionGate } from "@/components/SolutionGate";
import { Session } from "@/components/practice/Session";
import { Setup } from "@/components/practice/Setup";
import type { StartConfig } from "@/components/practice/types";
import { PostSession } from "@/components/postflop/PostSession";
import type { PracticeFilter } from "@/lib/practice/sampler";
import { SPOT_TYPES, SpotType } from "@/lib/solution/types";

/** `/practice/#seat=3&spot=vs3bet` pre-fills the conditions (used by the weak-spot shortcuts) */
interface Preset {
  filter: Partial<PracticeFilter>;
  mode?: "spot" | "hand" | "postSpot" | "post";
  scenario?: string;
  flop?: number;
}

function parseHash(): Preset {
  const p = new URLSearchParams(location.hash.replace(/^#/, ""));
  const out: Partial<PracticeFilter> = {};
  const seat = p.get("seat");
  if (seat !== null && /^[0-5]$/.test(seat)) out.seats = [Number(seat)];
  const spot = p.get("spot");
  if (spot && (SPOT_TYPES as string[]).includes(spot)) out.spots = [spot as SpotType];
  const mode = p.get("mode");
  const flop = p.get("flop");
  return {
    filter: out,
    mode: mode && ["spot", "hand", "postSpot", "post"].includes(mode) ? (mode as Preset["mode"]) : undefined,
    scenario: p.get("scenario") ?? undefined,
    flop: flop !== null && /^\d+$/.test(flop) ? Number(flop) : undefined,
  };
}

export default function PracticePage() {
  const [config, setConfig] = useState<StartConfig | null>(null);
  const [run, setRun] = useState(0);
  const [initial, setInitial] = useState<Preset | null>(null);
  useImmersive(config !== null);
  useEffect(() => setInitial(parseHash()), []);

  return (
    <SolutionGate grid={false}>
      {(store) =>
        config?.type === "pre" ? (
          <Session
            key={run}
            store={store}
            config={config.config}
            onPostflop={(c) => {
              setConfig({ type: "post", config: c });
              setRun((r) => r + 1);
            }}
            onExit={() => {
              setConfig(null);
              setRun((r) => r + 1);
            }}
          />
        ) : config?.type === "post" ? (
          <PostSession
            key={run}
            config={config.config}
            onExit={() => {
              setConfig(null);
              setRun((r) => r + 1);
            }}
          />
        ) : initial ? (
          <Setup initial={initial.filter} initialMode={initial.mode} initialScenario={initial.scenario} initialFlop={initial.flop} onStart={(c) => setConfig(c)} />
        ) : null
      }
    </SolutionGate>
  );
}
