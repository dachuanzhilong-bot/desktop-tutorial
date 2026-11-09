"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "@/lib/settings";
import type { Key } from "@/lib/i18n/ja";

export const TOUR_EVENT = "tessera:tour";

/** mini illustration of the range chart for step 2 */
function MiniChart() {
  const rows = [
    ["r", "r", "r", "m", "c", "f"],
    ["r", "r", "m", "c", "f", "f"],
    ["r", "m", "c", "c", "f", "f"],
    ["m", "c", "c", "f", "f", "f"],
    ["c", "c", "f", "f", "f", "f"],
    ["c", "f", "f", "f", "f", "f"],
  ];
  const col = (k: string) => (k === "r" ? "var(--raise-1)" : k === "c" ? "var(--call)" : k === "f" ? "var(--fold)" : "linear-gradient(90deg,var(--raise-1) 60%,var(--call) 60%)");
  return (
    <div aria-hidden className="mx-auto grid w-44 grid-cols-6 gap-[3px]">
      {rows.flat().map((k, i) => (
        <span key={i} className="aspect-square rounded-[4px]" style={{ background: col(k), backgroundImage: k === "r" ? "var(--pat-raise)" : k === "c" ? "var(--pat-call)" : undefined }} />
      ))}
    </div>
  );
}

function EvLossDemo() {
  return (
    <div aria-hidden className="mx-auto w-44 rounded-card bg-surface-2 py-3 text-center">
      <div className="text-xs text-muted">EV</div>
      <div className="text-4xl font-extrabold leading-none text-accent-text">−0.32</div>
      <div className="mt-1 text-xs text-muted">bb</div>
    </div>
  );
}

/** three short screens: how to read a chart, how answers are graded, how to play one-handed */
const STEPS: { t: Key; d: Key; art?: "chart" | "ev" }[] = [
  { t: "onb.s1.t", d: "onb.s1.d", art: "chart" },
  { t: "onb.s2.t", d: "onb.s2.d", art: "ev" },
  { t: "onb.s3.t", d: "onb.s3.d" },
];

export function Onboarding() {
  const { settings, set, t, ready } = useSettings();
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const router = useRouter();

  const open = useCallback(() => {
    setStep(0);
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // first launch: show the tour (step is still 0, so only the dialog has to open)
  useEffect(() => {
    const d = ref.current;
    if (ready && !settings.onboarded && d && !d.open) d.showModal();
  }, [ready, settings.onboarded]);

  useEffect(() => {
    const h = () => open();
    window.addEventListener(TOUR_EVENT, h);
    return () => window.removeEventListener(TOUR_EVENT, h);
  }, [open]);

  const finish = (go: boolean) => {
    ref.current?.close();
    set({ onboarded: true });
    if (go) router.push("/practice/");
  };

  const last = step === STEPS.length - 1;
  const s = STEPS[step];
  return (
    <dialog
      ref={ref}
      aria-labelledby="onb-title"
      closedby="any"
      onClose={() => !settings.onboarded && set({ onboarded: true })}
      data-testid="onboarding"
      className="m-auto w-[min(92vw,26rem)] rounded-sheet border border-line bg-surface p-0 text-ink shadow-2xl"
    >
      <div className="flex flex-col gap-4 p-6">
        <p className="text-xs font-semibold tracking-wide text-muted">{t("onb.step", { i: step + 1, n: STEPS.length })}</p>
        <h2 id="onb-title" className="text-2xl font-extrabold">
          {step === 0 ? t("onb.title") : t(s.t)}
        </h2>
        {step === 0 && <p className="-mt-2 text-lg font-bold text-accent-text">{t(s.t)}</p>}
        {s.art === "chart" && <MiniChart />}
        {s.art === "ev" && <EvLossDemo />}
        <p className="leading-relaxed text-muted">{t(s.d)}</p>
        <div className="flex gap-1.5" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-surface-2"}`} />
          ))}
        </div>
        <div className="flex gap-3">
          {step > 0 ? (
            <button type="button" onClick={() => setStep(step - 1)} className="min-h-tap-lg flex-1 rounded-control border border-line px-4 font-semibold">
              {t("common.back")}
            </button>
          ) : (
            <button type="button" onClick={() => finish(false)} className="min-h-tap-lg flex-1 rounded-control border border-line px-4 font-semibold">
              {t("common.skip")}
            </button>
          )}
          {last ? (
            <button
              type="button"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- initial focus inside the modal dialog
              autoFocus
              onClick={() => finish(true)} className="min-h-tap-lg flex-[2] rounded-control bg-accent px-4 font-bold text-accent-ink">
              {t("onb.start")}
            </button>
          ) : (
            <button
              type="button"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- keeps focus in the dialog when the step changes
              autoFocus
              onClick={() => setStep(step + 1)} className="min-h-tap-lg flex-[2] rounded-control bg-accent px-4 font-bold text-accent-ink">
              {t("common.next")}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
