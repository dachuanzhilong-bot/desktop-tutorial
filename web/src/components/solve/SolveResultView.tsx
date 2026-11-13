"use client";
import { LockPanel } from "@/components/solve/LockPanel";
import { PostflopViewer } from "@/components/postflop/PostflopViewer";
import { useSettings } from "@/lib/settings";
import type { SolveResult, SolveRun } from "@/lib/solve/run";

interface Props {
  result: SolveResult;
  run: SolveRun;
  oopName: string;
  ipName: string;
  title: string;
  onTitle: (title: string) => void;
  onSave: () => void;
  onOpenStudy: () => void;
  onView: (node: number) => void;
  /** lock (strategy) or unlock (null) an exported node, then run `iters` more iterations */
  onRelock: (exportedNode: number, seat: string, strategy: Float32Array | null, iters: number) => void;
}

/** a finished solve: how far it converged, saving it, the node locks and the strategy viewer */
export function SolveResultView({ result, run, oopName, ipName, title, onTitle, onSave, onOpenStudy, onView, onRelock }: Props) {
  const { t } = useSettings();
  const { locks } = run;
  return (
    <section className="space-y-3" aria-label={t("solve.result")} data-testid="solve-result">
      <div className="rounded-card border border-line bg-surface p-4">
        <h2 className="text-lg font-extrabold">{result.stopped ? t("solve.stopped") : t("solve.done")}</h2>
        <p className="text-sm text-muted" data-testid="solve-exploit">
          {t("solve.exploitLead", { x: result.exploit.toFixed(2) })} · {t("solve.iterCount", { n: result.iterations })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input aria-label={t("solve.saveName")} placeholder={t("solve.saveName")} value={title} onChange={(e) => onTitle(e.target.value)} className="min-h-tap min-w-0 flex-1 rounded-control border border-line bg-surface-2 px-3" />
          <button type="button" data-testid="solve-save" onClick={onSave} className="min-h-tap rounded-control bg-accent px-4 font-bold text-accent-ink">
            {t("solve.save")}
          </button>
          <button type="button" data-testid="solve-open-study" onClick={onOpenStudy} className="min-h-tap rounded-control border border-accent px-4 font-bold text-accent-text">
            {t("solve.openStudy")}
          </button>
          <span role="status" className="self-center text-sm text-muted">
            {run.note}
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
                  <button type="button" disabled={ex < 0} onClick={() => onView(ex)} className="min-h-tap rounded-full border border-accent px-3 text-sm font-semibold text-accent-text">
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
        nodeId={run.viewNode}
        onNode={onView}
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
              busy={run.phase === "locking"}
              unavailable={null}
              onApply={(strat, iters) => onRelock(node.id, seat, strat, iters)}
              onUnlock={(iters) => onRelock(node.id, seat, null, iters)}
            />
          );
        }}
      />
    </section>
  );
}
