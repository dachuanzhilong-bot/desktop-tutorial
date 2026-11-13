"use client";
import { MotionConfig } from "framer-motion";
import { useEffect, useState } from "react";
import { useImmersive } from "@/components/ShellContext";
import { SolutionGate } from "@/components/SolutionGate";
import { Session } from "@/components/practice/Session";
import { Setup } from "@/components/practice/Setup";
import type { PracticeSet, StartConfig } from "@/components/practice/types";
import { PostSession } from "@/components/postflop/PostSession";
import { resolveItems } from "@/lib/practice/review";
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

const NO_PRESET: Preset = { filter: {} };
const presetKey = (p: Preset) => `${p.mode ?? ""}|${p.scenario ?? ""}|${p.flop ?? ""}|${JSON.stringify(p.filter)}`;

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

/** waits until the solution of the question list is loaded (switching the stack depth if needed), then starts it */
function SetStarter({ store, pending, onStart }: { store: SolutionStore; pending: PracticeSet; onStart: () => void }) {
  useEffect(() => {
    if (store.manifest.id === pending.solution) onStart();
  }, [store, pending, onStart]);
  return <div className="h-40 animate-pulse rounded-card bg-surface" aria-busy="true" />;
}

export default function PracticePage() {
  const [config, setConfig] = useState<StartConfig | null>(null);
  const [run, setRun] = useState(0);
  const [initial, setInitial] = useState<Preset | null>(null);
  const [pending, setPending] = useState<PracticeSet | null>(null);
  const { setDepth } = useSolutionStore();
  useImmersive(config !== null);
  useEffect(() => {
    // the URL hash (presets, question lists from Analyze) is only known in the browser, after hydration
    const preset = parseHash();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL hash
    if (!preset.set) return setInitial(preset);
    // a question list from Analyze: start right away
    getRepo()
      .getMeta<PracticeSet>(`practiceSet:${preset.set}`)
      .then((s) => {
        if (s?.items.length) {
          setDepth(depthOf(s.solution));
          setPending(s);
        } else setInitial({ ...preset, set: undefined });
      })
      .catch(() => setInitial({ ...preset, set: undefined }));
  }, [setDepth]);

  // the setup screen needs no solution data: it is part of the static HTML and painted at once.
  // A preset from the URL (read after hydration) remounts it with those values.
  const shown = initial ?? NO_PRESET;
  if (!config && !pending && !shown.set)
    return <Setup key={presetKey(shown)} initial={shown.filter} initialMode={shown.mode} initialScenario={shown.scenario} initialFlop={shown.flop} onStart={(c) => setConfig(c)} onReview={(s) => { setDepth(depthOf(s.solution)); setPending(s); }} />;

  return (
    // every practice animation follows the OS "reduce motion" setting
    <MotionConfig reducedMotion="user">
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
              // each question gets the node its position key has in the loaded data
              const fixed = resolveItems(store.manifest, pending.items);
              // nothing left to ask (today's data has none of the positions): back to the setup screen
              if (fixed.length) setConfig({ type: "pre", config: { mode: "spot", filter: { ...DEFAULT_FILTER }, rng: false, timer: 0, fixed, title: pending.title } });
              else setInitial(NO_PRESET);
              setPending(null);
            }}
          />
        ) : null
      }
    </SolutionGate>
    </MotionConfig>
  );
}
