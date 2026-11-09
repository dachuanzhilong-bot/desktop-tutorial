"use client";
import { useEffect, useState } from "react";
import { useImmersive } from "@/components/ShellContext";
import { SolutionGate } from "@/components/SolutionGate";
import { Session } from "@/components/practice/Session";
import { Setup } from "@/components/practice/Setup";
import type { StartConfig } from "@/components/practice/types";
import { PostSession } from "@/components/postflop/PostSession";
import { DEFAULT_FILTER } from "@/lib/practice/sampler";
import type { PracticeFilter } from "@/lib/practice/sampler";
import { getRepo } from "@/lib/storage/idb";
import { useSolutionStore } from "@/lib/solution/context";
import { depthOf } from "@/lib/solution/loader";
import type { SolutionStore } from "@/lib/solution/loader";
import { SPOT_TYPES, SpotType } from "@/lib/solution/types";

/** `/practice/#seat=3&spot=vs3bet` pre-fills the conditions (used by the weak-spot shortcuts) */
interface Preset {
  /** `#set=<id>`: a question list prepared by Analyze */
  set?: string;
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
    set: p.get("set") ?? undefined,
    filter: out,
    mode: mode && ["spot", "hand", "postSpot", "post"].includes(mode) ? (mode as Preset["mode"]) : undefined,
    scenario: p.get("scenario") ?? undefined,
    flop: flop !== null && /^\d+$/.test(flop) ? Number(flop) : undefined,
  };
}

interface PendingSet {
  title: string;
  /** solution id the node ids belong to (absent in sets made before stack depths existed: 100bb) */
  solution?: string;
  items: { nodeId: number; hand: number }[];
}

/** waits until the solution of the question list is loaded (switching the stack depth if needed), then starts it */
function SetStarter({ store, pending, onStart }: { store: SolutionStore; pending: PendingSet; onStart: () => void }) {
  useEffect(() => {
    if (store.manifest.id === (pending.solution ?? "cash6max-100bb")) onStart();
  }, [store, pending, onStart]);
  return <div className="h-40 animate-pulse rounded-card bg-surface" aria-busy="true" />;
}

export default function PracticePage() {
  const [config, setConfig] = useState<StartConfig | null>(null);
  const [run, setRun] = useState(0);
  const [initial, setInitial] = useState<Preset | null>(null);
  const [pending, setPending] = useState<PendingSet | null>(null);
  const { setDepth } = useSolutionStore();
  useImmersive(config !== null);
  useEffect(() => {
    // the URL hash (presets, question lists from Analyze) is only known in the browser, after hydration
    const preset = parseHash();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL hash
    if (!preset.set) return setInitial(preset);
    // a question list from Analyze: start right away
    getRepo()
      .getMeta<PendingSet>(`practiceSet:${preset.set}`)
      .then((s) => {
        if (s?.items.length) {
          setDepth(depthOf(s.solution));
          setPending(s);
        } else setInitial({ ...preset, set: undefined });
      })
      .catch(() => setInitial({ ...preset, set: undefined }));
  }, [setDepth]);

  return (
    <SolutionGate grid={false}>
      {(store) =>
        config?.type === "pre" ? (
          <Session
            key={run}
            store={store}
            config={config.config}
            onPostflop={store.manifest.stack === 100 ? (c) => {
              setConfig({ type: "post", config: c });
              setRun((r) => r + 1);
            } : undefined}
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
        ) : pending ? (
          <SetStarter
            store={store}
            pending={pending}
            onStart={() => {
              setConfig({ type: "pre", config: { mode: "spot", filter: { ...DEFAULT_FILTER }, rng: false, timer: 0, fixed: pending.items, title: pending.title } });
              setPending(null);
            }}
          />
        ) : initial ? (
          <Setup initial={initial.filter} initialMode={initial.mode} initialScenario={initial.scenario} initialFlop={initial.flop} onStart={(c) => setConfig(c)} />
        ) : null
      }
    </SolutionGate>
  );
}
