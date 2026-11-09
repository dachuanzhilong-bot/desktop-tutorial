"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayingCard } from "@/components/PlayingCard";
import { BetSizes } from "@/components/solve/BetSizes";
import { BoardPicker } from "@/components/solve/BoardPicker";
import { LockPanel } from "@/components/solve/LockPanel";
import { RangeField } from "@/components/solve/RangeField";
import { SolveTabs } from "@/components/solve/SolveTabs";
import { PostflopViewer } from "@/components/postflop/PostflopViewer";
import type { Key } from "@/lib/i18n/ja";
import { parseBoard, cardOf, cardText } from "@/lib/postflop/combos";
import { decodeFlop, PfFlop } from "@/lib/postflop/decode";
import { loadIndex } from "@/lib/postflop/loader";
import { RANGE_PRESETS, availablePresets, presetRange } from "@/lib/ranges/presets";
import { formatRange, parseRange, rangeCombos } from "@/lib/ranges/range";
import { SolverClient } from "@/lib/solve/client";
import type { Exported, Progress } from "@/lib/solve/client";
import { costHint, DEFAULT_SOLVE, SolveConfig } from "@/lib/solve/config";
import { loadDraft, saveDraft } from "@/lib/solve/draft";
import type { SolveAccuracy } from "@/lib/solve/draft";
import { newId } from "@/lib/util/id";
import { useSolutionStore } from "@/lib/solution/context";
import { fmtBB } from "@/lib/solution/tree";
import { useSettings } from "@/lib/settings";
import { getRepo } from "@/lib/storage/idb";
import type { SavedRange, SavedSolve } from "@/lib/storage/types";

type Phase = "idle" | "building" | "running" | "done" | "locking";
type Acc = SolveAccuracy;

/** iterations per accuracy level for a solve that starts on the [flop, turn, river] */
const ITERS: Record<Acc, [number, number, number]> = { draft: [60, 150, 300], std: [250, 600, 1000], high: [600, 2000, 4000] };
const TARGET: Record<Acc, number> = { draft: 2, std: 1, high: 0.5 };
const iterFor = (acc: Acc, boardLen: number) => ITERS[acc][Math.max(0, Math.min(2, boardLen - 3))];


interface Result {
  flop: PfFlop;
  map: Uint32Array;
  exploit: number;
  iterations: number;
  bytes: Uint8Array;
  stopped: boolean;
}

const DEFAULT_BOARD = parseBoard("Ks 7d 2c");

export default function SolvePage() {
  const { t } = useSettings();
  const { store } = useSolutionStore();
  const router = useRouter();
  const clientRef = useRef<SolverClient | null>(null);

  const [board, setBoard] = useState<number[]>(DEFAULT_BOARD);
  const [oopText, setOopText] = useState("");
  const [ipText, setIpText] = useState("");
  const [oopName, setOopName] = useState("BB");
  const [ipName, setIpName] = useState("BTN");
  const [pot, setPot] = useState("5.5");
  const [stack, setStack] = useState("97.5");
  const [cfg, setCfg] = useState<SolveConfig>(DEFAULT_SOLVE);
  const [acc, setAcc] = useState<Acc>("std");
  const [iterations, setIterations] = useState(iterFor("std", 3));
  const [target, setTarget] = useState(TARGET.std);

  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lastExploit, setLastExploit] = useState<number | null>(null);
  const [nodes, setNodes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [viewNode, setViewNode] = useState(0);
  const [locks, setLocks] = useState<Map<number, string>>(new Map());
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [mine, setMine] = useState<SavedSolve[]>([]);
  const [savedRanges, setSavedRanges] = useState<SavedRange[]>([]);
  const [ready, setReady] = useState(false);
  const [wasmOk, setWasmOk] = useState(true);
  const defaultsApplied = useRef(false);

  const busy = phase === "building" || phase === "running" || phase === "locking";
  const startStreet = Math.max(0, Math.min(2, board.length - 3));

  // ------------------------------------------------------------ restore the draft / a saved solve
  const loadSaved = useCallback((s: SavedSolve) => {
    setBoard(s.board);
    setCfg(s.cfg as SolveConfig);
    setPot(String((s.cfg as SolveConfig).pot));
    setStack(String((s.cfg as SolveConfig).stack));
    setOopText(s.oopText);
    setIpText(s.ipText);
    setOopName(s.oopName);
    setIpName(s.ipName);
    setTitle(s.title);
    setSavedId(s.id);
    defaultsApplied.current = true;
    setResult(null);
    setPhase("idle");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capabilities and the stored draft exist only after hydration
    setWasmOk(typeof WebAssembly === "object");
    // the draft (validated + migrated by SOLVE_DRAFT_SCHEMA) only exists in browser storage, so it is read after hydration
    const d = loadDraft();
    if (d.board) setBoard(d.board);
    if (d.oopText) setOopText(d.oopText);
    if (d.ipText) setIpText(d.ipText);
    if (d.oopName !== undefined) setOopName(d.oopName);
    if (d.ipName !== undefined) setIpName(d.ipName);
    if (d.pot) setPot(String(d.pot));
    if (d.stack) setStack(String(d.stack));
    if (d.cfg) setCfg(d.cfg);
    if (d.acc) setAcc(d.acc);
    if (d.iterations) setIterations(d.iterations);
    if (d.target) setTarget(d.target);
    const repo = getRepo();
    repo.listRanges().then(setSavedRanges).catch(() => {});
    repo.listSolves().then(setMine).catch(() => {});
    const from = new URLSearchParams(location.hash.replace(/^#/, "")).get("from");
    if (from) repo.getSolve(from).then((s) => s && loadSaved(s)).catch(() => {});
    setReady(true);
    return () => clientRef.current?.terminate();
  }, [loadSaved]);

  useEffect(() => {
    if (!ready) return;
    saveDraft({ board, oopText, ipText, oopName, ipName, pot: Number(pot) || 0, stack: Number(stack) || 0, cfg, acc, iterations, target });
  }, [ready, board, oopText, ipText, oopName, ipName, pot, stack, cfg, acc, iterations, target]);

  const applyPresets = async (oopId: string, ipId: string) => {
    if (!store) return;
    const [a, b] = await Promise.all([oopId, ipId].map((id) => presetRange(store, RANGE_PRESETS.find((p) => p.id === id)!)));
    // never overwrite what the user (or the Range Builder) already put in
    if (a) setOopText((cur) => cur || formatRange(a));
    if (b) setIpText((cur) => cur || formatRange(b));
  };

  // first visit: BB defends against a BTN open
  useEffect(() => {
    if (!ready || !store || defaultsApplied.current) return;
    defaultsApplied.current = true;
    void applyPresets("bb-call-btn", "btn-open");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per store; applyPresets is recreated every render
  }, [ready, store]);

  const have = useMemo(() => new Set((store ? availablePresets(store) : RANGE_PRESETS).map((p) => p.id)), [store]);
  const can3bp = have.has("bb-3bet-btn") && have.has("btn-call-3bet");
  const depthBB = store?.manifest.stack ?? 100;

  const quick = async (kind: "srp" | "3bp") => {
    setOopName("BB");
    setIpName("BTN");
    setOopText("");
    setIpText("");
    if (kind === "srp") {
      await applyPresets("bb-call-btn", "btn-open");
    } else {
      await applyPresets("bb-3bet-btn", "btn-call-3bet");
    }
    try {
      const ix = await loadIndex();
      const sc = ix.scenarios.find((s) => s.id === (kind === "srp" ? "srp-btn-bb" : "3bp-btn-bb"));
      if (sc) {
        // the postflop data are 100bb; at another depth the pot is the same and the stack behind is what is left
        const invested = (sc.pot - 0.5) / 2;
        setPot(String(sc.pot));
        setStack(String(depthBB === 100 ? sc.stack : Math.max(1, Math.round((depthBB - invested) * 10) / 10)));
      }
    } catch {
      setPot(kind === "srp" ? "5.5" : "20.5");
      setStack(kind === "srp" ? "97.5" : "89");
    }
  };

  // accuracy presets follow the first street that is solved
  const pickAcc = (a: Acc) => {
    setAcc(a);
    setIterations(iterFor(a, board.length));
    setTarget(TARGET[a]);
  };
  const [itersForLen, setItersForLen] = useState(board.length);
  if (itersForLen !== board.length) {
    // a different first street needs a different iteration count (adjusted while rendering, not in an effect)
    setItersForLen(board.length);
    setIterations(iterFor(acc, board.length));
  }

  const fullCfg: SolveConfig = useMemo(() => ({ ...cfg, pot: Number(pot) || 0, stack: Number(stack) || 0 }), [cfg, pot, stack]);
  const hint = costHint(board.length, fullCfg);
  const fmtTime = (sec: number) => (sec >= 90 ? t("solve.min", { n: Math.round(sec / 60) }) : t("solve.sec", { n: Math.max(1, Math.round(sec)) }));
  const estSeconds = (iterations * hint.msPerIter) / 1000;
  const oopR = useMemo(() => parseRange(oopText).range, [oopText]);
  const ipR = useMemo(() => parseRange(ipText).range, [ipText]);
  const spr = Number(pot) > 0 ? Number(stack) / Number(pot) : 0;
  const canRun = wasmOk && !busy && board.length >= 3 && Number(pot) > 0 && Number(stack) > 0 && rangeCombos(oopR) > 0 && rangeCombos(ipR) > 0;

  const getClient = () => (clientRef.current ??= new SolverClient());

  const publish = (exp: Exported, iters: number, stopped: boolean, keepNode: number | null) => {
    const flop = decodeFlop(exp.bytes);
    setResult({ flop, map: exp.map, exploit: exp.exploit, iterations: iters, bytes: exp.bytes, stopped });
    setViewNode(keepNode !== null && keepNode >= 0 && keepNode < flop.nodes.length ? keepNode : 0);
  };

  const onProgress = (p: Progress) => {
    setProgress(p);
    if (p.exploit >= 0) setLastExploit(p.exploit);
  };

  // ------------------------------------------------------------ run
  const run = async () => {
    setError(null);
    setNote("");
    setSavedId(null);
    setResult(null);
    setLocks(new Map());
    setProgress(null);
    setLastExploit(null);
    setPhase("building");
    try {
      const c = getClient();
      await c.init();
      const n = await c.create({ board, cfg: fullCfg, ranges: [oopR, ipR] });
      setNodes(n);
      setPhase("running");
      const r = await c.run({ iterations, restartAt: Math.floor(iterations * 0.5), target, onProgress });
      const exp = await c.export(0.004);
      publish(exp, r.iterations, r.cancelled, null);
      setLastExploit(exp.exploit);
      setPhase("done");
    } catch (e) {
      setError(t("solve.error", { msg: e instanceof Error ? e.message : String(e) }));
      setPhase("idle");
    }
  };

  const stop = () => clientRef.current?.cancel();

  // ------------------------------------------------------------ node lock
  const relock = async (exportedNode: number, seat: string, strategy: Float32Array | null, iters: number) => {
    if (!result) return;
    const c = getClient();
    const tree = result.map[exportedNode];
    setError(null);
    setPhase("locking");
    setProgress(null);
    try {
      if (strategy) {
        const ok = await c.lock(tree, strategy);
        if (!ok) throw new Error("lock rejected");
        setLocks((m) => new Map(m).set(tree, seat));
      } else {
        await c.unlock(tree);
        setLocks((m) => {
          const n = new Map(m);
          n.delete(tree);
          return n;
        });
      }
      const r = await c.run({ iterations: iters, restartAt: Math.floor(iters * 0.5), onProgress });
      const exp = await c.export(0.004);
      publish(exp, r.iterations, r.cancelled, exp.map.indexOf(tree));
      setLastExploit(exp.exploit);
      setSavedId(null);
    } catch (e) {
      setError(t("solve.error", { msg: e instanceof Error ? e.message : String(e) }));
    }
    setPhase("done");
  };

  // ------------------------------------------------------------ save
  const refreshMine = () =>
    getRepo()
      .listSolves()
      .then(setMine)
      .catch(() => {});
  const save = async () => {
    if (!result) return null;
    const id = savedId ?? newId("s");
    const auto = `${board.map((c) => cardText(c)).join(" ")} · ${oopName} vs ${ipName}`;
    await getRepo().putSolve({
      id,
      ts: Date.now(),
      title: title.trim() || auto,
      board,
      cfg: fullCfg,
      oopName,
      ipName,
      oopText,
      ipText,
      exploit: result.exploit,
      iterations: result.iterations,
      bytes: result.bytes,
      nodes: result.flop.nodes.length,
    });
    setSavedId(id);
    setNote(t("solve.savedOk"));
    void refreshMine();
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

      <fieldset disabled={busy} className="min-w-0 space-y-5 border-0 p-0">
        <section className="space-y-2" aria-label={t("solve.quick")}>
          <h2 className="font-bold">{t("solve.quick")}</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="quick-srp" onClick={() => quick("srp")} className="min-h-tap rounded-control border border-line bg-surface px-3.5 text-sm font-semibold">
              {t("solve.quick.srp")}
            </button>
            <button type="button" data-testid="quick-3bp" disabled={!can3bp} onClick={() => quick("3bp")} className="min-h-tap rounded-control border border-line bg-surface px-3.5 text-sm font-semibold disabled:opacity-45">
              {t("solve.quick.3bp")}
            </button>
          </div>
        </section>

        <BoardPicker board={board} onChange={setBoard} />

        <section className="space-y-2" aria-label={t("solve.ranges")}>
          <h2 className="font-bold">{t("solve.ranges")}</h2>
          <RangeField label={`${oopName} · ${t("pf.oop")}`} text={oopText} onText={setOopText} saved={savedRanges} testId="range-oop" />
          <RangeField label={`${ipName} · ${t("pf.ip")}`} text={ipText} onText={setIpText} saved={savedRanges} testId="range-ip" />
        </section>

        <section className="space-y-2" aria-label={t("solve.potStack")}>
          <h2 className="font-bold">{t("solve.potStack")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-muted">
              {t("solve.pot")}
              <input data-testid="pot-input" type="number" inputMode="decimal" min={1} step={0.5} value={pot} onChange={(e) => setPot(e.target.value)} className="mt-1 block min-h-tap w-full rounded-control border border-line bg-surface px-3 text-ink" />
            </label>
            <label className="block text-sm text-muted">
              {t("solve.stack")}
              <input data-testid="stack-input" type="number" inputMode="decimal" min={1} step={0.5} value={stack} onChange={(e) => setStack(e.target.value)} className="mt-1 block min-h-tap w-full rounded-control border border-line bg-surface px-3 text-ink" />
            </label>
          </div>
          <p className="text-xs text-muted">{t("solve.spr", { n: spr.toFixed(1) })}</p>
        </section>

        <BetSizes cfg={cfg} startStreet={startStreet} onChange={setCfg} />

        <section className="space-y-3" aria-label={t("solve.accuracy")}>
          <h2 className="font-bold">{t("solve.accuracy")}</h2>
          <div role="group" aria-label={t("solve.accuracy")} className="grid grid-cols-3 gap-1 rounded-card bg-surface p-1">
            {(["draft", "std", "high"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={acc === a} data-testid={`acc-${a}`} onClick={() => pickAcc(a)} className={`min-h-tap rounded-control text-sm font-bold ${acc === a ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}>
                {t(`solve.acc.${a}` as Key)}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted" data-testid="solve-estimate">
            {t("solve.iterations")}: <b className="text-ink">{iterations}</b> · {t("solve.est", { s: fmtTime(estSeconds) })} · {t("solve.target")}: <b className="text-ink">{target}</b>
          </p>
          {hint.level === "slow" && <p className="text-sm text-muted">{t("solve.heavy")}</p>}
          <details className="rounded-card border border-line bg-surface p-3">
            <summary className="min-h-tap cursor-pointer font-semibold">{t("solve.advanced")}</summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-sm text-muted">
                {t("solve.iterations")}
                <input type="number" min={10} max={5000} step={10} value={iterations} onChange={(e) => setIterations(Math.max(10, Math.min(5000, Number(e.target.value) || 10)))} className="mt-1 block min-h-tap w-full rounded-control border border-line bg-surface-2 px-3 text-ink" />
              </label>
              <label className="block text-sm text-muted">
                {t("solve.target")}
                <input type="number" min={0.05} max={10} step={0.05} value={target} onChange={(e) => setTarget(Math.max(0.05, Number(e.target.value) || 1))} className="mt-1 block min-h-tap w-full rounded-control border border-line bg-surface-2 px-3 text-ink" />
              </label>
              {board.length < 5 && (
                <label className="block text-sm text-muted">
                  {board.length === 3 ? t("solve.turnCards") : t("solve.riverCards")}
                  <select
                    value={board.length === 3 ? cfg.turnCards : cfg.riverCards}
                    onChange={(e) => setCfg(board.length === 3 ? { ...cfg, turnCards: Number(e.target.value) } : { ...cfg, riverCards: Number(e.target.value) })}
                    className="mt-1 block min-h-tap w-full rounded-control border border-line bg-surface-2 px-3 text-ink"
                  >
                    {(board.length === 3 ? [4, 6, 8] : [1, 2, 4, 8]).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {board.length === 3 && (
                <label className="block text-sm text-muted">
                  {t("solve.riverCards")}
                  <select value={cfg.riverCards} onChange={(e) => setCfg({ ...cfg, riverCards: Number(e.target.value) })} className="mt-1 block min-h-tap w-full rounded-control border border-line bg-surface-2 px-3 text-ink">
                    {[1, 2, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {board.length < 5 && <p className="mt-2 text-xs text-muted">{t("solve.sampleHint")}</p>}
          </details>
        </section>
      </fieldset>

      {/* run */}
      <section className="space-y-3 rounded-card border border-line bg-surface p-4" aria-label={t("solve.run")}>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button type="button" data-testid="solve-run" disabled={!canRun} onClick={run} className="min-h-cta rounded-card bg-accent text-lg font-extrabold text-accent-ink shadow disabled:opacity-50">
            {phase === "building" ? t("solve.preparing") : t("solve.run")}
          </button>
          {(phase === "running" || phase === "locking") && (
            <button type="button" data-testid="solve-stop" onClick={stop} className="min-h-cta rounded-card border border-line px-5 font-bold">
              {t("solve.stop")}
            </button>
          )}
        </div>
        {!(rangeCombos(oopR) > 0 && rangeCombos(ipR) > 0) && <p className="text-xs text-muted">{t("solve.noRange")}</p>}
        {(phase === "running" || phase === "locking") && (
          <div data-testid="solve-progress" role="status" aria-live="polite">
            <div className="h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ? Math.round((100 * progress.done) / progress.total) : 0} aria-label={t("solve.running")}>
              <div className="h-full bg-accent transition-[width]" style={{ width: `${progress ? (100 * progress.done) / progress.total : 0}%` }} />
            </div>
            <p className="mt-1 text-sm text-muted">
              {progress ? t("solve.progress", { done: progress.done, total: progress.total, x: (lastExploit ?? progress.exploit) >= 0 ? (lastExploit ?? progress.exploit).toFixed(2) : "…" }) : phase === "locking" ? t("solve.lock.running") : t("solve.running")}
              {progress?.elapsed && progress.done > 0 && progress.done < progress.total ? ` · ${t("solve.eta", { s: fmtTime(((progress.elapsed / progress.done) * (progress.total - progress.done)) / 1000) })}` : ""}
              {nodes > 0 ? ` · ${t("solve.nodes", { n: nodes.toLocaleString() })}` : ""}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-[color:var(--g-blunder)]" data-testid="solve-error">
            {error}
          </p>
        )}
      </section>

      {/* result */}
      {result && (
        <section className="space-y-3" aria-label={t("solve.result")} data-testid="solve-result">
          <div className="rounded-card border border-line bg-surface p-4">
            <h2 className="text-lg font-extrabold">{result.stopped ? t("solve.stopped") : t("solve.done")}</h2>
            <p className="text-sm text-muted" data-testid="solve-exploit">
              {t("solve.exploitLead", { x: result.exploit.toFixed(2) })} · {t("solve.iterCount", { n: result.iterations })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input aria-label={t("solve.saveName")} placeholder={t("solve.saveName")} value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-tap min-w-0 flex-1 rounded-control border border-line bg-surface-2 px-3" />
              <button type="button" data-testid="solve-save" onClick={save} className="min-h-tap rounded-control bg-accent px-4 font-bold text-accent-ink">
                {t("solve.save")}
              </button>
              <button
                type="button"
                data-testid="solve-open-study"
                onClick={async () => {
                  const id = await save();
                  if (id) router.push(`/study/postflop/#solve=${id}`);
                }}
                className="min-h-tap rounded-control border border-accent px-4 font-bold text-accent-text"
              >
                {t("solve.openStudy")}
              </button>
              <span role="status" className="self-center text-sm text-muted">
                {note}
              </span>
            </div>
          </div>

          {locks.size > 0 && (
            <div className="rounded-card border border-line bg-surface p-3" data-testid="lock-list">
              <p className="mb-1.5 text-sm font-bold">{t("solve.lock.list")}</p>
              <ul className="flex flex-wrap gap-1.5">
                {[...locks.entries()].map(([tree, seat]) => {
                  const ex = result.map.indexOf(tree);
                  return (
                    <li key={tree}>
                      <button type="button" disabled={ex < 0} onClick={() => setViewNode(ex)} className="min-h-tap rounded-full border border-accent px-3 text-sm font-semibold text-accent-text">
                        {seat} #{ex}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <PostflopViewer
            flop={result.flop}
            oopName={oopName}
            ipName={ipName}
            exploit={result.exploit}
            nodeId={viewNode}
            onNode={setViewNode}
            extra={({ node, d, actions, selected, inFilter, seat }) => {
              const tree = result.map[node.id];
              return (
                <LockPanel
                  key={node.id}
                  d={d}
                  actions={actions}
                  selected={selected}
                  inFilter={inFilter}
                  seat={seat}
                  locked={locks.has(tree)}
                  busy={phase === "locking"}
                  unavailable={null}
                  onApply={(strat, iters) => relock(node.id, seat, strat, iters)}
                  onUnlock={(iters) => relock(node.id, seat, null, iters)}
                />
              );
            }}
          />
        </section>
      )}

      {/* saved solves */}
      <section className="space-y-2" aria-label={t("solve.mine")}>
        <h2 className="font-bold">{t("solve.mine")}</h2>
        {mine.length === 0 ? (
          <p className="rounded-card border border-dashed border-line p-4 text-sm text-muted">{t("solve.mineEmpty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="saved-solves">
            {mine.map((s) => (
              <li key={s.id} className="rounded-card border border-line bg-surface p-3">
                <div className="flex items-center gap-2">
                  <span className="flex shrink-0 gap-0.5">
                    {s.board.map((c) => (
                      <PlayingCard key={c} card={cardOf(c)} size="sm" />
                    ))}
                  </span>
                </div>
                <p className="mt-1.5 truncate font-bold">{s.title}</p>
                <p className="text-xs text-muted">
                  {new Date(s.ts).toLocaleString()} · Exploitability {s.exploit.toFixed(2)}% · {t("pf.pot", { pot: fmtBB((s.cfg as SolveConfig).pot), stack: fmtBB((s.cfg as SolveConfig).stack) })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href={`/study/postflop/#solve=${s.id}`} className="min-h-tap rounded-control bg-accent px-3.5 py-2 text-sm font-bold text-accent-ink">
                    {t("solve.openStudy")}
                  </Link>
                  <button type="button" onClick={() => loadSaved(s)} className="min-h-tap rounded-control border border-line px-3.5 text-sm font-semibold">
                    {t("solve.reload")}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await getRepo().deleteSolve(s.id);
                      void refreshMine();
                    }}
                    className="min-h-tap rounded-control px-3 text-sm text-muted"
                  >
                    {t("solve.delete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
