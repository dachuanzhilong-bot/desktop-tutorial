"use client";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { RunPanel } from "@/components/solve/RunPanel";
import { SavedSolveList } from "@/components/solve/SavedSolveList";
import { SolveInputs } from "@/components/solve/SolveInputs";
import { SolveResultView } from "@/components/solve/SolveResultView";
import { SolveTabs } from "@/components/solve/SolveTabs";
import { useSavedSolves } from "@/components/solve/useSavedSolves";
import { useSolveForm } from "@/components/solve/useSolveForm";
import { useSolveRun } from "@/components/solve/useSolveRun";
import { parseRange, rangeCombos } from "@/lib/ranges/range";
import { fullConfig, potOf, stackOf } from "@/lib/solve/form";
import { isBusy, savedSolveOf } from "@/lib/solve/run";
import { useSettings } from "@/lib/settings";
import type { SavedSolve } from "@/lib/storage/types";
import { newId } from "@/lib/util/id";

/**
 * Solve: the Rust solver in the browser (WebAssembly, in a worker). The inputs (useSolveForm), the run with its node
 * locks (useSolveRun) and the saved solves (useSavedSolves) each keep their own state; this page wires them together.
 */
export default function SolvePage() {
  const { t } = useSettings();
  const router = useRouter();
  const { form, set, pickAcc, quick, can3bp, load } = useSolveForm();
  const { run, wasmOk, start, stop, relock, view, markSaved, reset } = useSolveRun();

  const open = useCallback(
    (s: SavedSolve) => {
      load(s);
      reset(s.id);
    },
    [load, reset],
  );
  const saved = useSavedSolves(open);

  const busy = isBusy(run.phase);
  const oopR = useMemo(() => parseRange(form.oopText).range, [form.oopText]);
  const ipR = useMemo(() => parseRange(form.ipText).range, [form.ipText]);
  const haveRanges = rangeCombos(oopR) > 0 && rangeCombos(ipR) > 0;
  const canRun = wasmOk && !busy && form.board.length >= 3 && potOf(form) > 0 && stackOf(form) > 0 && haveRanges;

  const save = async () => {
    if (!run.result) return null;
    const id = run.savedId ?? newId("s");
    await saved.put(savedSolveOf(form, run.result, id, Date.now()));
    markSaved(id, t("solve.savedOk"));
    return id;
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-extrabold">{t("solve.title")}</h1>
        <p className="text-sm text-muted">{t("solve.subtitle")}</p>
      </header>
      <SolveTabs />
      {!wasmOk && (
        <p role="alert" className="rounded-card border border-line bg-surface p-4 text-sm">
          {t("solve.noWasm")}
        </p>
      )}

      <SolveInputs form={form} set={set} pickAcc={pickAcc} quick={quick} can3bp={can3bp} savedRanges={saved.ranges} busy={busy} />

      <RunPanel run={run} canRun={canRun} haveRanges={haveRanges} onRun={() => start({ board: form.board, cfg: fullConfig(form), ranges: [oopR, ipR] }, form.iterations, form.target)} onStop={stop} />

      {run.result && (
        <SolveResultView
          result={run.result}
          run={run}
          oopName={form.oopName}
          ipName={form.ipName}
          title={form.title}
          onTitle={(title) => set({ title })}
          onSave={save}
          onOpenStudy={async () => {
            const id = await save();
            if (id) router.push(`/study/postflop/#solve=${id}`);
          }}
          onView={view}
          onRelock={relock}
        />
      )}

      <SavedSolveList mine={saved.mine} onLoad={open} onDelete={saved.remove} />
    </div>
  );
}
