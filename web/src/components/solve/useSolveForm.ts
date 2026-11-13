"use client";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { loadIndex } from "@/lib/postflop/loader";
import { RANGE_PRESETS, availablePresets, presetRange } from "@/lib/ranges/presets";
import { formatRange } from "@/lib/ranges/range";
import { useSolutionStore } from "@/lib/solution/context";
import { loadDraft, saveDraft } from "@/lib/solve/draft";
import type { SolveAccuracy } from "@/lib/solve/draft";
import { draftOf, formReducer, INITIAL_FORM } from "@/lib/solve/form";
import type { FormPatch } from "@/lib/solve/form";
import type { SavedSolve } from "@/lib/storage/types";

/** the Solve screen's inputs (lib/solve/form.ts), kept as a draft in localStorage, with the preset ranges */
export function useSolveForm() {
  const { store } = useSolutionStore();
  const [form, dispatch] = useReducer(formReducer, INITIAL_FORM);
  const [ready, setReady] = useState(false);
  const defaultsApplied = useRef(false);

  useEffect(() => {
    // the draft (validated + migrated by SOLVE_DRAFT_SCHEMA) only exists in browser storage, so it is read after hydration
    dispatch({ type: "restore", draft: loadDraft() });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored draft exists only after hydration
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveDraft(draftOf(form));
  }, [ready, form]);

  const applyPresets = useCallback(
    async (oopId: string, ipId: string) => {
      if (!store) return;
      const [a, b] = await Promise.all([oopId, ipId].map((id) => presetRange(store, RANGE_PRESETS.find((p) => p.id === id)!)));
      // never overwrite what the user (or the Range Builder) already put in
      dispatch({ type: "fillRanges", oop: a ? formatRange(a) : undefined, ip: b ? formatRange(b) : undefined });
    },
    [store],
  );

  // first visit: BB defends against a BTN open
  useEffect(() => {
    if (!ready || !store || defaultsApplied.current) return;
    defaultsApplied.current = true;
    void applyPresets("bb-call-btn", "btn-open");
  }, [ready, store, applyPresets]);

  const have = useMemo(() => new Set((store ? availablePresets(store) : RANGE_PRESETS).map((p) => p.id)), [store]);
  const can3bp = have.has("bb-3bet-btn") && have.has("btn-call-3bet");
  const depthBB = store?.manifest.stack ?? 100;

  const quick = async (kind: "srp" | "3bp") => {
    dispatch({ type: "set", patch: { oopName: "BB", ipName: "BTN", oopText: "", ipText: "" } });
    await (kind === "srp" ? applyPresets("bb-call-btn", "btn-open") : applyPresets("bb-3bet-btn", "btn-call-3bet"));
    try {
      const ix = await loadIndex();
      const sc = ix.scenarios.find((s) => s.id === (kind === "srp" ? "srp-btn-bb" : "3bp-btn-bb"));
      if (sc) {
        // the postflop data are 100bb; at another depth the pot is the same and the stack behind is what is left
        const invested = (sc.pot - 0.5) / 2;
        dispatch({ type: "set", patch: { pot: String(sc.pot), stack: String(depthBB === 100 ? sc.stack : Math.max(1, Math.round((depthBB - invested) * 10) / 10)) } });
      }
    } catch {
      dispatch({ type: "set", patch: kind === "srp" ? { pot: "5.5", stack: "97.5" } : { pot: "20.5", stack: "89" } });
    }
  };

  const set = useCallback((patch: FormPatch) => dispatch({ type: "set", patch }), []);
  const pickAcc = useCallback((acc: SolveAccuracy) => dispatch({ type: "accuracy", acc }), []);
  /** a saved solve opened again (its ranges are not replaced by the presets) */
  const load = useCallback((solve: SavedSolve) => {
    defaultsApplied.current = true;
    dispatch({ type: "load", solve });
  }, []);

  return { form, set, pickAcc, quick, can3bp, load };
}
