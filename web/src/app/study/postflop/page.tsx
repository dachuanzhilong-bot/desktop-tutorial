"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GridSkeleton, Skeleton } from "@/components/Skeleton";
import { StudyTabs } from "@/components/StudyTabs";
import { PostflopViewer } from "@/components/postflop/PostflopViewer";
import { PlayingCard } from "@/components/PlayingCard";
import { cardOf } from "@/lib/postflop/combos";
import { decodeFlop, PfFlop } from "@/lib/postflop/decode";
import { loadFlop, loadIndex, PfIndex } from "@/lib/postflop/loader";
import { fmtBB } from "@/lib/solution/tree";
import { useSettings } from "@/lib/settings";
import { getRepo } from "@/lib/storage/idb";
import type { SavedSolve } from "@/lib/storage/types";

/** a solve made on the Solve screen, opened by #solve=<id> */
function SavedView({ id }: { id: string }) {
  const { t } = useSettings();
  const [saved, setSaved] = useState<SavedSolve | null | undefined>(undefined);
  const [flop, setFlop] = useState<PfFlop | null>(null);
  const [nodeId, setNodeId] = useState(0);
  useEffect(() => {
    getRepo()
      .getSolve(id)
      .then((s) => {
        setSaved(s ?? null);
        if (s) setFlop(decodeFlop(s.bytes));
      })
      .catch(() => setSaved(null));
  }, [id]);
  if (saved === undefined) return <GridSkeleton />;
  if (saved === null || !flop)
    return (
      <p role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">
        {t("pf.missing")}
      </p>
    );
  return (
    <>
      <section className="rounded-2xl border border-line bg-surface p-3" aria-label={t("solve.mine")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-extrabold" data-testid="saved-title">
              {saved.title}
            </h2>
            <p className="text-xs text-muted">
              {saved.oopName} {t("pf.oop")} · {saved.ipName} {t("pf.ip")} · {t("pf.pot", { pot: fmtBB(flop.pot), stack: fmtBB(flop.stack) })}
            </p>
          </div>
          <Link href={`/solve/#from=${saved.id}`} className="min-h-10 rounded-full border border-accent px-3.5 py-2 text-sm font-bold text-accent-text">
            {t("solve.reload")}
          </Link>
        </div>
      </section>
      <PostflopViewer flop={flop} oopName={saved.oopName} ipName={saved.ipName} exploit={saved.exploit} nodeId={nodeId} onNode={setNodeId} />
    </>
  );
}

function PostflopStudy() {
  const { t } = useSettings();
  const [index, setIndex] = useState<PfIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<string>("");
  const [flopIdx, setFlopIdx] = useState(0);
  const [flop, setFlop] = useState<PfFlop | null>(null);
  const [nodeId, setNodeId] = useState(0);
  const [solveId, setSolveId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const p = new URLSearchParams(location.hash.replace(/^#/, ""));
    const sid = p.get("solve");
    setSolveId(sid);
    if (sid) return;
    loadIndex()
      .then((ix) => {
        setIndex(ix);
        const s = p.get("s");
        setScenario(s && ix.scenarios.some((x) => x.id === s) ? s : ix.scenarios[0]?.id ?? "");
        setFlopIdx(Math.min(Number(p.get("f") ?? 0) || 0, ix.flops.length - 1));
        setNodeId(Number(p.get("n") ?? 0) || 0);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    if (!scenario) return;
    let alive = true;
    setFlop(null);
    loadFlop(scenario, flopIdx)
      .then((f) => alive && setFlop(f))
      .catch((e) => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [scenario, flopIdx]);

  useEffect(() => {
    if (!scenario) return;
    try {
      history.replaceState(null, "", `${location.pathname}#s=${scenario}&f=${flopIdx}&n=${nodeId}`);
    } catch {
      /* ignore */
    }
  }, [scenario, flopIdx, nodeId]);

  const sc = index?.scenarios.find((s) => s.id === scenario);

  const header = (
    <>
      <header>
        <h1 className="text-2xl font-extrabold">{t("study.title")}</h1>
        <p className="text-sm text-muted">{t("study.subtitle")}</p>
      </header>
      <StudyTabs />
    </>
  );

  if (solveId)
    return (
      <div className="space-y-4">
        {header}
        <SavedView id={solveId} />
      </div>
    );

  if (error)
    return (
      <p role="alert" className="rounded-2xl border border-line bg-surface p-4 text-sm">
        {t("pf.missing")} {error}
      </p>
    );
  if (solveId === undefined || !index || !sc)
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <GridSkeleton />
      </div>
    );

  return (
    <div className="space-y-4">
      {header}

      {/* scenario + flop */}
      <section className="space-y-2" aria-label={t("pf.scenario")}>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {index.scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === scenario}
              data-testid={`scenario-${s.id}`}
              onClick={() => {
                setScenario(s.id);
                setNodeId(0);
              }}
              className={`min-h-10 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold ${s.id === scenario ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`}
            >
              {s.title}
            </button>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="listbox" aria-label={t("pf.flop")}>
          {index.flops.map((f, i) => {
            const cards = f.split(" ");
            return (
              <button
                key={f}
                type="button"
                role="option"
                aria-selected={i === flopIdx}
                data-testid={`flop-${i}`}
                onClick={() => {
                  setFlopIdx(i);
                  setNodeId(0);
                  }}
                className={`flex shrink-0 gap-0.5 rounded-xl border-2 p-1.5 ${i === flopIdx ? "border-accent bg-surface-2" : "border-transparent bg-surface"}`}
              >
                {cards.map((c) => (
                  <PlayingCard key={c} card={cardOf("23456789TJQKA".indexOf(c[0]) * 4 + "cdhs".indexOf(c[1]))} size="sm" />
                ))}
              </button>
            );
          })}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <Link href={`/practice/#mode=postSpot&scenario=${scenario}&flop=${flopIdx}`} data-testid="practice-this-flop" className="rounded-full border border-accent px-3 py-1.5 text-sm font-bold text-accent-text">
            {t("pf.practice")}
          </Link>
          <span>
          {sc.oop} {t("pf.oop")} {sc.oopPct.toFixed(0)}% · {sc.ip} {t("pf.ip")} {sc.ipPct.toFixed(0)}% · {t("pf.pot", { pot: fmtBB(sc.pot), stack: fmtBB(sc.stack) })}
          </span>
        </p>
      </section>


      {flop ? (
        <PostflopViewer key={`${scenario}/${flopIdx}`} flop={flop} oopName={sc.oop} ipName={sc.ip} exploit={index.stats[`${scenario}/${flopIdx}`]?.exploit ?? 0} nodeId={nodeId} onNode={setNodeId} />
      ) : (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <GridSkeleton />
        </div>
      )}
    </div>
  );
}

export default function PostflopStudyPage() {
  return <PostflopStudy />;
}
