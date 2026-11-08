"use client";
import { useEffect, useMemo, useState } from "react";
import { IconDice, IconTimer } from "@/components/icons";
import { DEFAULT_FILTER, PracticeFilter } from "@/lib/practice/sampler";
import { HAND_FILTERS, HandFilterId } from "@/lib/poker/hands";
import { getRepo } from "@/lib/storage/idb";
import { useSettings } from "@/lib/settings";
import { SPOT_TYPES, SpotType } from "@/lib/solution/types";
import type { Key } from "@/lib/i18n/ja";
import type { PracticeConfig } from "./types";

const SEATS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
const TIMERS = [0, 5, 10, 20];

function Chip({ on, children, onClick, testid }: { on: boolean; children: React.ReactNode; onClick: () => void; testid?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testid}
      onClick={onClick}
      className={`min-h-10 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function Toggle({ label, desc, on, onChange, icon, testid }: { label: string; desc?: string; on: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode; testid?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testid}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-left"
    >
      <span className="text-muted">{icon}</span>
      <span className="flex-1">
        <span className="block font-bold">{label}</span>
        {desc && <span className="block text-xs text-muted">{desc}</span>}
      </span>
      <span aria-hidden className={`relative h-7 w-12 rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-2"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

export function Setup({ onStart, initial }: { onStart: (c: PracticeConfig) => void; initial?: Partial<PracticeFilter> }) {
  const { t } = useSettings();
  const [mode, setMode] = useState<"spot" | "hand">("spot");
  const [filter, setFilter] = useState<PracticeFilter>({ ...DEFAULT_FILTER, ...initial });
  const [rng, setRng] = useState(false);
  const [timer, setTimer] = useState(0);
  const [due, setDue] = useState(0);

  useEffect(() => {
    getRepo()
      .allSrs()
      .then((all) => setDue(all.filter((s) => s.due <= Date.now()).length))
      .catch(() => {});
  }, []);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const spotsLabel = useMemo(() => (filter.spots.length ? "" : t("common.any")), [filter.spots, t]);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold">{t("practice.title")}</h1>
        <p className="text-sm text-muted">{t("practice.subtitle")}</p>
      </header>

      <section aria-label={t("practice.mode")} className="grid grid-cols-2 gap-2.5">
        {(["spot", "hand"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            data-testid={`mode-${m}`}
            onClick={() => setMode(m)}
            className={`rounded-2xl border p-3.5 text-left transition-colors ${mode === m ? "border-accent bg-accent/15" : "border-line bg-surface"}`}
          >
            <span className="block font-extrabold">{t(`practice.mode.${m}` as Key)}</span>
            <span className="mt-0.5 block text-xs text-muted">{t(`practice.mode.${m}Desc` as Key)}</span>
          </button>
        ))}
      </section>

      <section className="space-y-3" aria-label={t("practice.conditions")}>
        <h2 className="text-sm font-bold text-muted">{t("practice.conditions")}</h2>
        <div>
          <p className="mb-1.5 text-sm font-semibold">{t("practice.seat")}</p>
          <div className="flex flex-wrap gap-1.5">
            <Chip on={filter.seats.length === 0} onClick={() => setFilter({ ...filter, seats: [] })}>
              {t("common.any")}
            </Chip>
            {SEATS.map((s, i) => (
              <Chip key={s} on={filter.seats.includes(i)} testid={`seat-${s}`} onClick={() => setFilter({ ...filter, seats: toggle(filter.seats, i) })}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
        {mode === "spot" && (
          <div>
            <p className="mb-1.5 text-sm font-semibold">
              {t("practice.spots")} <span className="font-normal text-muted">{spotsLabel}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SPOT_TYPES.map((s: SpotType) => (
                <Chip key={s} on={filter.spots.includes(s)} testid={`spot-${s}`} onClick={() => setFilter({ ...filter, spots: toggle(filter.spots, s) })}>
                  {t(`spot.${s}` as Key)}
                </Chip>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-sm font-semibold">{t("practice.handRange")}</p>
          <div className="flex flex-wrap gap-1.5">
            {HAND_FILTERS.map((f: HandFilterId) => (
              <Chip key={f} on={filter.hands === f} onClick={() => setFilter({ ...filter, hands: f })}>
                {t(`hf.${f}` as Key)}
              </Chip>
            ))}
          </div>
        </div>
        {mode === "spot" && <Toggle label={t("practice.mixedOnly")} on={filter.mixedOnly} onChange={(v) => setFilter({ ...filter, mixedOnly: v })} />}
      </section>

      <section className="space-y-2.5">
        <Toggle label={t("practice.rng")} desc={t("practice.rngDesc")} on={rng} onChange={setRng} icon={<IconDice width={22} height={22} />} testid="toggle-rng" />
        <div className="rounded-2xl border border-line bg-surface p-3.5">
          <p className="mb-2 flex items-center gap-2 font-bold">
            <IconTimer width={20} height={20} className="text-muted" />
            {t("practice.timer")}
          </p>
          <div className="flex gap-1.5">
            {TIMERS.map((s) => (
              <Chip key={s} on={timer === s} testid={`timer-${s}`} onClick={() => setTimer(s)}>
                {s === 0 ? t("practice.timerOff") : t("practice.timerSec", { n: s })}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      {due > 0 && <p className="text-sm text-accent-text">{t("practice.due", { n: due })}</p>}

      <button
        type="button"
        data-testid="start-practice"
        onClick={() => onStart({ mode, filter, rng, timer })}
        className="min-h-14 w-full rounded-2xl bg-accent text-lg font-extrabold text-accent-ink shadow-lg active:scale-[0.98]"
      >
        {t("practice.begin")}
      </button>
    </div>
  );
}
