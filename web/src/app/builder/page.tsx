"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { IconUndo } from "@/components/icons";
import { RangeCells } from "@/components/ranges/RangeCells";
import { SolveTabs } from "@/components/solve/SolveTabs";
import { Term } from "@/components/Term";
import { ALL_CLASSES, NUM_CLASSES } from "@/lib/poker/hands";
import { RANGE_PRESETS, availablePresets, presetRange } from "@/lib/ranges/presets";
import { editorReducer, initEditor } from "@/lib/ranges/editor";
import { compareRanges, emptyRange, formatRange, parseRange, rangeCombos, rangePercent } from "@/lib/ranges/range";
import { saveDraft } from "@/lib/solve/draft";
import { useSolutionStore } from "@/lib/solution/context";
import { useSettings } from "@/lib/settings";
import { getRepo } from "@/lib/storage/idb";
import type { SavedRange } from "@/lib/storage/types";
import { haptic } from "@/lib/util/haptics";
import { useHash } from "@/lib/util/hooks";
import { newId } from "@/lib/util/id";

const BRUSHES = [1, 0.75, 0.5, 0.25];

const SHORTCUTS: { id: string; key: "builder.sc.pairs" | "builder.sc.suited" | "builder.sc.offsuit" | "builder.sc.broadway"; test: (c: (typeof ALL_CLASSES)[number]) => boolean }[] = [
  { id: "pairs", key: "builder.sc.pairs", test: (c) => c.pair },
  { id: "suited", key: "builder.sc.suited", test: (c) => c.suited },
  { id: "offsuit", key: "builder.sc.offsuit", test: (c) => !c.suited && !c.pair },
  { id: "broadway", key: "builder.sc.broadway", test: (c) => c.lo <= 4 },
];

export default function BuilderPage() {
  const { t } = useSettings();
  const { store } = useSolutionStore();
  const router = useRouter();
  const [ed, dispatch] = useReducer(editorReducer, undefined, () => initEditor());
  const { present: range, text, textErr } = ed;
  const [brush, setBrush] = useState(1);
  const [tool, setTool] = useState<"paint" | "erase">("paint");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<SavedRange[]>([]);
  const [note, setNote] = useState("");
  const [refId, setRefId] = useState("");
  const [loadedRef, setLoadedRef] = useState<{ id: string; range: Float32Array } | null>(null);
  const ref = refId && loadedRef?.id === refId ? loadedRef.range : null;
  const [overlay, setOverlay] = useState(true);

  const refresh = useCallback(() => {
    getRepo()
      .listRanges()
      .then(setSaved)
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  // deep link: #text=<range> (e.g. from Study) opens that range
  const hash = useHash();
  const [seenHash, setSeenHash] = useState("");
  if (hash !== seenHash) {
    setSeenHash(hash);
    const initial = new URLSearchParams(hash).get("text");
    if (initial) dispatch({ type: "set", range: parseRange(initial).range });
  }

  const apply = useCallback((r: Float32Array) => dispatch({ type: "set", range: r }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  // Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y (text fields keep their own undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) undo();
      else if ((k === "z" && e.shiftKey) || k === "y") redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---- painting (one drag = one undo step)
  const onPaint = useCallback(
    (cls: number, phase: "start" | "move") => {
      if (phase === "start") haptic.tap();
      dispatch({ type: "paint", cls, phase, brush, erase: tool === "erase" });
    },
    [brush, tool],
  );
  const onPaintEnd = useCallback(() => dispatch({ type: "strokeEnd" }), []);

  const fill = (test: (c: (typeof ALL_CLASSES)[number]) => boolean) => {
    const v = tool === "erase" ? 0 : brush;
    const next = Float32Array.from(range);
    for (const c of ALL_CLASSES) if (test(c)) next[c.id] = v;
    apply(next);
    haptic.tap();
  };

  const combos = rangeCombos(range);
  const pct = rangePercent(range);

  // ---- comparison
  useEffect(() => {
    const preset = RANGE_PRESETS.find((p) => p.id === refId);
    if (!preset || !store) return;
    let alive = true;
    presetRange(store, preset)
      .then((r) => alive && r && setLoadedRef({ id: refId, range: r }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refId, store]);
  const cmp = useMemo(() => (ref ? compareRanges(range, ref) : null), [range, ref]);

  // ---- save / load
  const save = async () => {
    const nm = name.trim() || `${t("solve.tab.builder")} ${new Date().toLocaleDateString()}`;
    await getRepo().putRange({ id: newId("r"), ts: Date.now(), name: nm, text: formatRange(range) });
    setName("");
    setNote(t("builder.saved"));
    refresh();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(t("builder.copied"));
    } catch {
      setNote("");
    }
  };
  const use = (seat: "oop" | "ip") => {
    saveDraft(seat === "oop" ? { oopText: formatRange(range) } : { ipText: formatRange(range) });
    router.push("/solve/");
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">{t("builder.title")}</h1>
        <p className="text-sm text-muted">{t("builder.subtitle")}</p>
      </header>
      <SolveTabs />

      {/* tools */}
      <section className="space-y-2" aria-label={t("builder.brush")}>
        <div className="flex items-center gap-2">
          <div role="group" aria-label={t("builder.brush")} className="flex flex-1 gap-1 rounded-2xl bg-surface p-1">
            {BRUSHES.map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={tool === "paint" && brush === b}
                data-testid={`brush-${b * 100}`}
                onClick={() => {
                  setTool("paint");
                  setBrush(b);
                }}
                className={`min-h-11 flex-1 rounded-xl text-sm font-bold ${tool === "paint" && brush === b ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
              >
                {Math.round(b * 100)}%
              </button>
            ))}
            <button type="button" aria-pressed={tool === "erase"} data-testid="tool-erase" onClick={() => setTool("erase")} className={`min-h-11 flex-1 rounded-xl text-sm font-bold ${tool === "erase" ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
              {t("builder.erase")}
            </button>
          </div>
        </div>
        <label className="flex items-center gap-3 px-1 text-sm text-muted">
          <span className="shrink-0">{t("builder.brush")}</span>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={Math.round(brush * 100)}
            onChange={(e) => {
              setTool("paint");
              setBrush(Number(e.target.value) / 100);
            }}
            className="h-8 w-full accent-[var(--accent)]"
            aria-label={t("builder.brush")}
          />
          <span className="w-10 shrink-0 text-right font-bold tabular-nums text-ink">{Math.round(brush * 100)}%</span>
        </label>
      </section>

      <RangeCells value={range} reference={ref} overlay={!!ref && overlay} onPaint={onPaint} onPaintEnd={onPaintEnd} ariaLabel={t("builder.title")} cellLabel={(n, w) => t("builder.cell", { name: n, pct: Math.round(w * 100) })} />
      <p className="text-xs text-muted">{t("builder.hint")}</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-extrabold" data-testid="builder-stats" aria-live="polite">
          {t("builder.stats", { combos: combos.toFixed(combos % 1 ? 1 : 0), pct: pct.toFixed(1) })}
        </p>
        <div className="flex gap-1.5" role="group" aria-label={t("builder.history")}>
          <button type="button" data-testid="builder-undo" onClick={undo} disabled={!ed.past.length} aria-keyshortcuts="Control+Z Meta+Z" className="flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold disabled:opacity-40">
            <IconUndo width={18} height={18} aria-hidden />
            {t("builder.undo")}
          </button>
          <button type="button" data-testid="builder-redo" onClick={redo} disabled={!ed.future.length} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" className="flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold disabled:opacity-40">
            <IconUndo width={18} height={18} aria-hidden className="-scale-x-100" />
            {t("builder.redo")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("builder.shortcuts")}>
          {SHORTCUTS.map((s) => (
            <button key={s.id} type="button" onClick={() => fill(s.test)} className="min-h-10 rounded-full border border-line bg-surface px-3 text-sm font-semibold">
              {t(s.key)}
            </button>
          ))}
          <button type="button" onClick={() => fill(() => true)} className="min-h-10 rounded-full border border-line bg-surface px-3 text-sm font-semibold">
            {t("builder.sc.all")}
          </button>
          <button type="button" onClick={() => apply(emptyRange())} data-testid="builder-clear" className="min-h-10 rounded-full border border-line bg-surface px-3 text-sm font-semibold">
            {t("builder.sc.clear")}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = new Float32Array(NUM_CLASSES);
              for (let i = 0; i < NUM_CLASSES; i++) next[i] = range[i] > 0.004 ? 0 : 1;
              apply(next);
            }}
            className="min-h-10 rounded-full border border-line bg-surface px-3 text-sm font-semibold"
          >
            {t("builder.sc.invert")}
          </button>
        </div>
      </div>

      {/* text I/O */}
      <section className="space-y-2 rounded-2xl border border-line bg-surface p-4" aria-label={t("builder.text")}>
        <label htmlFor="range-text" className="block font-bold">
          <Term id="range">{t("builder.text")}</Term>
        </label>
        <textarea
          id="range-text"
          data-testid="range-text"
          value={text}
          onChange={(e) => dispatch({ type: "text", text: e.target.value })}
          rows={3}
          spellCheck={false}
          placeholder={t("builder.textHint")}
          className="w-full rounded-xl border border-line bg-surface-2 p-3 font-mono text-sm"
        />
        {textErr.length > 0 && (
          <p role="alert" className="text-sm text-[color:var(--g-blunder)]">
            {t("solve.parseErr", { list: textErr.join(", ") })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="range-import"
            onClick={() => dispatch({ type: "import" })}
            className="min-h-11 rounded-xl bg-accent px-4 font-bold text-accent-ink"
          >
            {t("builder.import")}
          </button>
          <button type="button" onClick={copy} className="min-h-11 rounded-xl border border-line px-4 font-semibold">
            {t("builder.copy")}
          </button>
          <span role="status" className="self-center text-sm text-muted">
            {note}
          </span>
        </div>
      </section>

      {/* compare with GTO */}
      <section className="space-y-2 rounded-2xl border border-line bg-surface p-4" aria-label={t("builder.compare")}>
        <h2 className="font-bold">{t("builder.compare")}</h2>
        <label className="block text-sm text-muted">
          {t("builder.ref")}
          <select data-testid="ref-select" value={refId} onChange={(e) => setRefId(e.target.value)} className="mt-1 block min-h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-ink">
            <option value="">{t("builder.refNone")}</option>
            {(store ? availablePresets(store) : RANGE_PRESETS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {cmp && (
          <div className="space-y-1" data-testid="compare">
            <p className="text-3xl font-extrabold">
              {t("builder.score", { n: cmp.score.toFixed(0) })}
              <span className="ml-1 text-base font-semibold text-muted">/ 100</span>
            </p>
            <p className="text-xs text-muted">{t("builder.scoreHint")}</p>
            <p className="text-sm">{t("builder.missing", { n: cmp.missing.toFixed(0) })}</p>
            <p className="text-sm">{t("builder.extra", { n: cmp.extra.toFixed(0) })}</p>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} className="h-5 w-5" />
              {t("builder.overlay")}
            </label>
            {overlay && (
              <ul className="flex flex-wrap gap-3 text-xs" aria-label="legend">
                {(
                  [
                    ["call", "builder.legend.ok"],
                    ["fold", "builder.legend.missing"],
                    ["raise1", "builder.legend.extra"],
                  ] as const
                ).map(([k, label]) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <span className="seg inline-block h-3.5 w-3.5 rounded-sm" data-k={k} />
                    {t(label)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* save / load */}
      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4" aria-label={t("builder.mine")}>
        <h2 className="font-bold">{t("builder.mine")}</h2>
        <div className="flex gap-2">
          <input aria-label={t("builder.name")} placeholder={t("builder.name")} value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 flex-1 rounded-xl border border-line bg-surface-2 px-3" />
          <button type="button" data-testid="range-save" onClick={save} disabled={combos <= 0} className="min-h-11 rounded-xl bg-accent px-4 font-bold text-accent-ink disabled:opacity-50">
            {t("builder.save")}
          </button>
        </div>
        {saved.length === 0 ? (
          <p className="text-sm text-muted">{t("builder.mineEmpty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="saved-ranges">
            {saved.map((r) => {
              const rr = parseRange(r.text).range;
              return (
                <li key={r.id} className="flex items-center gap-3 rounded-xl bg-surface-2 p-2">
                  <div className="w-14 shrink-0">
                    <RangeCells value={rr} bare ariaLabel={r.name} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{r.name}</p>
                    <p className="text-xs text-muted">{t("builder.stats", { combos: rangeCombos(rr).toFixed(0), pct: rangePercent(rr).toFixed(1) })}</p>
                  </div>
                  <button type="button" onClick={() => apply(rr)} className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold">
                    {t("builder.load")}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await getRepo().deleteRange(r.id);
                      refresh();
                    }}
                    className="min-h-10 rounded-lg px-2 text-sm text-muted"
                  >
                    {t("builder.delete")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-line bg-surface p-4" aria-label={t("builder.use")}>
        <h2 className="font-bold">{t("builder.use")}</h2>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" data-testid="use-oop" disabled={combos <= 0} onClick={() => use("oop")} className="min-h-12 rounded-xl border border-accent font-bold text-accent-text disabled:opacity-50">
            {t("builder.useOop")}
          </button>
          <button type="button" data-testid="use-ip" disabled={combos <= 0} onClick={() => use("ip")} className="min-h-12 rounded-xl border border-accent font-bold text-accent-text disabled:opacity-50">
            {t("builder.useIp")}
          </button>
        </div>
        <Link href="/solve/" className="inline-block text-sm text-accent-text underline">
          {t("solve.tab.solve")}
        </Link>
      </section>
    </div>
  );
}
