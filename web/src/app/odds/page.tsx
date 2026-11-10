"use client";
import { useState } from "react";
import { SolveTabs } from "@/components/solve/SolveTabs";
import { OddsQuiz } from "@/components/odds/OddsQuiz";
import { betNumbers, callEv, DRAW_PRESETS, impliedNeeded, outsEquity, spr, sprBand } from "@/lib/poker/math";
import type { Key } from "@/lib/i18n/ja";
import { useSettings } from "@/lib/settings";

/** "12,5" and "12.5" both work; anything else is not a number (null) */
const parse = (s: string): number | null => {
  const x = Number(s.trim().replace(",", "."));
  return s.trim() !== "" && Number.isFinite(x) ? x : null;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const amount = (x: number) => String(Number(x.toFixed(2)));

function Field({ id, label, value, onChange, suffix }: { id: string; label: string; value: string; onChange: (v: string) => void; suffix?: string }) {
  return (
    <label htmlFor={id} className="block text-xs text-muted">
      {label}
      <span className="mt-0.5 flex items-center gap-1">
        <input
          id={id}
          data-testid={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-tap w-full rounded-control border border-line bg-surface-2 px-3 text-base font-bold text-ink"
        />
        {suffix && <span className="text-sm text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

function Row({ label, value, help, testId }: { label: string; value: string; help?: string; testId: string }) {
  // a definition list may only hold dt / dd inside its groups: the help text is a second dd
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 border-t border-line py-2">
      <dt className="text-sm">{label}</dt>
      <dd className="text-right text-lg font-extrabold tabular-nums" data-testid={testId}>
        {value}
      </dd>
      {help && <dd className="col-span-2 mt-0.5 text-xs text-muted">{help}</dd>}
    </div>
  );
}

export default function OddsPage() {
  const { t } = useSettings();
  const [pot, setPot] = useState("100");
  const [bet, setBet] = useState("50");
  const [eq, setEq] = useState("30");
  const [outs, setOuts] = useState("9");
  const [street, setStreet] = useState<"flop" | "turn">("flop");
  const [stack, setStack] = useState("250");
  const [pot2, setPot2] = useState("50");

  const b = (() => {
    const p = parse(pot);
    const x = parse(bet);
    return p === null || x === null ? null : betNumbers(p, x);
  })();
  const equity = parse(eq);
  const e = equity === null ? null : equity / 100;
  const ev = b && e !== null ? callEv(parse(pot)!, parse(bet)!, e) : null;
  const implied = b && e !== null ? impliedNeeded(parse(pot)!, parse(bet)!, e) : null;
  const o = (() => {
    const n = parse(outs);
    return n === null ? null : outsEquity(n, street);
  })();
  const ratio = (() => {
    const s = parse(stack);
    const p = parse(pot2);
    return s === null || p === null ? null : spr(s, p);
  })();

  const evText = (v: number) => (Math.abs(v) < 0.005 ? t("odds.v.even", { x: "0" }) : v > 0 ? t("odds.v.plus", { x: `+${amount(v)}` }) : t("odds.v.minus", { x: amount(v) }));
  const chip = (on: boolean) => `min-h-tap rounded-full border px-3 text-sm font-semibold ${on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"}`;
  const dash = "–";

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">{t("odds.title")}</h1>
        <p className="text-sm text-muted">{t("odds.subtitle")}</p>
      </header>
      <SolveTabs />
      <OddsQuiz />

      <section className="space-y-3 rounded-card border border-line bg-surface p-3" aria-label={t("odds.bet.title")} data-testid="odds-bet-card">
        <h2 className="font-bold">{t("odds.bet.title")}</h2>
        <p className="text-xs text-muted">{t("odds.bet.hint")}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field id="odds-pot" label={t("odds.pot")} value={pot} onChange={setPot} />
          <Field id="odds-bet" label={t("odds.bet")} value={bet} onChange={setBet} />
        </div>
        <Field id="odds-eq" label={t("odds.eq")} value={eq} onChange={setEq} suffix="%" />
        <dl>
          <Row testId="odds-size" label={t("odds.r.size")} value={b ? t("odds.v.size", { x: (b.size * 100).toFixed(0) }) : dash} />
          <Row testId="odds-call" label={t("odds.r.call")} value={b ? amount(b.toCall) : dash} />
          <Row testId="odds-win" label={t("odds.r.win")} value={b ? amount(b.toWin) : dash} />
          <Row testId="odds-need" label={t("odds.r.need")} value={b ? pct(b.needed) : dash} help={t("odds.help.need")} />
          <Row testId="odds-ratio" label={t("odds.r.ratio")} value={b ? `${b.ratio.toFixed(2)} : 1` : dash} />
          <Row testId="odds-mdf" label={t("odds.r.mdf")} value={b ? pct(b.mdf) : dash} help={t("odds.help.mdf")} />
          <Row testId="odds-bluff" label={t("odds.r.bluff")} value={b ? pct(b.bluffShare) : dash} help={t("odds.help.bluff")} />
          <Row testId="odds-alpha" label={t("odds.r.alpha")} value={b ? pct(b.alpha) : dash} help={t("odds.help.alpha")} />
          <Row testId="odds-ev" label={t("odds.r.ev")} value={ev === null ? dash : evText(ev)} />
          <Row testId="odds-implied" label={t("odds.r.implied")} value={implied === null ? dash : implied === 0 ? t("odds.v.implied0") : amount(implied)} help={t("odds.help.implied")} />
        </dl>
      </section>

      <section className="space-y-3 rounded-card border border-line bg-surface p-3" aria-label={t("odds.outs.title")} data-testid="odds-outs-card">
        <h2 className="font-bold">{t("odds.outs.title")}</h2>
        <p className="text-xs text-muted">{t("odds.outs.hint")}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("odds.outs.title")}>
          {DRAW_PRESETS.map((d) => (
            <button key={d.id} type="button" aria-pressed={parse(outs) === d.outs} data-testid={`draw-${d.id}`} onClick={() => setOuts(String(d.outs))} className={chip(parse(outs) === d.outs)}>
              {t("odds.draw.label", { name: t(`odds.draw.${d.id}` as Key), n: d.outs })}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <Field id="odds-outs" label={t("odds.outs.n")} value={outs} onChange={setOuts} />
          <div role="group" aria-label={t("odds.outs.street")} className="grid grid-cols-2 gap-1 rounded-control bg-surface-2 p-1">
            {(["flop", "turn"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={street === s} data-testid={`street-${s}`} onClick={() => setStreet(s)} className={`min-h-tap rounded-control text-sm font-bold ${street === s ? "bg-accent text-accent-ink" : "text-muted"}`}>
                {t(`odds.street.${s}` as Key)}
              </button>
            ))}
          </div>
        </div>
        <dl>
          <Row testId="odds-next" label={t("odds.outs.next")} value={o ? pct(o.next) : dash} />
          <Row testId="odds-river" label={t("odds.outs.river")} value={o ? pct(o.river) : dash} />
          <Row testId="odds-rule" label={t("odds.outs.rule")} value={o ? pct(o.rule) : dash} />
        </dl>
      </section>

      <section className="space-y-3 rounded-card border border-line bg-surface p-3" aria-label={t("odds.spr.title")} data-testid="odds-spr-card">
        <h2 className="font-bold">{t("odds.spr.title")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field id="odds-stack" label={t("odds.spr.stack")} value={stack} onChange={setStack} />
          <Field id="odds-pot2" label={t("odds.spr.pot")} value={pot2} onChange={setPot2} />
        </div>
        <dl>
          <Row testId="odds-spr" label={t("odds.spr.value")} value={ratio === null ? dash : ratio.toFixed(1)} help={ratio === null ? undefined : t(`odds.spr.${sprBand(ratio)}` as Key)} />
        </dl>
        <p className="text-xs text-muted">{t("odds.spr.note")}</p>
      </section>
    </div>
  );
}
