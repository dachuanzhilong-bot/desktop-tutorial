"use client";

/** Minimal accessible SVG charts (no dependency). */

export function LineChart({ values, labels, height = 120, max = 100, label }: { values: (number | null)[]; labels?: string[]; height?: number; max?: number; label: string }) {
  const w = 320;
  const pad = { l: 28, r: 8, t: 8, b: 18 };
  const iw = w - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const n = values.length;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const pts = values.map((v, i) => (v === null ? null : [x(i), y(v)] as const));
  let d = "";
  let pen = false;
  for (const p of pts) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
    pen = true;
  }
  const ticks = [0, max / 2, max];
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${height}`} className="w-full">
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={pad.l} x2={w - pad.r} y1={y(tk)} y2={y(tk)} stroke="var(--line)" strokeWidth="1" />
          <text x={pad.l - 4} y={y(tk) + 3} textAnchor="end" fontSize="9" fill="var(--muted)">
            {Math.round(tk)}
          </text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="var(--accent)" />)}
      {labels && (
        <>
          <text x={pad.l} y={height - 4} fontSize="9" fill="var(--muted)">
            {labels[0]}
          </text>
          <text x={w - pad.r} y={height - 4} fontSize="9" fill="var(--muted)" textAnchor="end">
            {labels[labels.length - 1]}
          </text>
        </>
      )}
    </svg>
  );
}

export function Histogram({ bins, labels, height = 90, label, color = "var(--accent)" }: { bins: number[]; labels?: string[]; height?: number; label: string; color?: string }) {
  const w = 320;
  const pad = { t: 6, b: 16 };
  const max = Math.max(...bins, 1e-9);
  const bw = w / bins.length;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${height}`} className="w-full">
      {bins.map((b, i) => {
        const h = (b / max) * (height - pad.t - pad.b);
        return <rect key={i} x={i * bw + 2} y={height - pad.b - h} width={bw - 4} height={Math.max(h, 0.5)} rx="3" fill={color} opacity={0.9} />;
      })}
      {labels?.map((l, i) => (
        <text key={i} x={i * bw + bw / 2} y={height - 3} fontSize="9" textAnchor="middle" fill="var(--muted)">
          {l}
        </text>
      ))}
    </svg>
  );
}

export function Ring({ value, max, label, children }: { value: number; max: number; label: string; children?: React.ReactNode }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, max > 0 ? value / max : 0);
  return (
    <div className="relative grid h-24 w-24 place-items-center" role="img" aria-label={label}>
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} style={{ transition: "stroke-dasharray .6s ease" }} />
      </svg>
      <div className="text-center leading-tight">{children}</div>
    </div>
  );
}
