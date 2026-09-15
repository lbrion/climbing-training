import { useRef, useState } from 'react';

const W = 320;
const H = 120;
const PAD = { l: 34, r: 10, t: 14, b: 22 };

export function TrendChart({
  label,
  unit,
  weekStarts,
  values,
  formatValue,
}: {
  label: string;
  unit: string;
  weekStarts: string[];
  values: (number | null)[];
  formatValue?: (v: number) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const points = values
    .map((v, i) => (v === null ? null : { i, v, weekStart: weekStarts[i] }))
    .filter((p): p is { i: number; v: number; weekStart: string } => p !== null);

  if (points.length === 0) {
    return (
      <div className="trend-card">
        <div className="trend-head">
          <span className="stat-label">{label}</span>
          <span className="stat-sub">No data yet</span>
        </div>
        <p className="hint trend-empty">Log sessions to build this trend.</p>
      </div>
    );
  }

  const nums = points.map((p) => p.v);
  const rawLo = Math.min(...nums);
  const rawHi = Math.max(...nums);
  const pad = rawHi === rawLo ? Math.max(1, Math.abs(rawHi) * 0.1 || 1) : (rawHi - rawLo) * 0.12;
  const lo = rawLo - pad;
  const hi = rawHi + pad;
  const n = Math.max(values.length - 1, 1);
  const x = (i: number) => PAD.l + (i / n) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const fmt = formatValue ?? ((v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)));

  // Build path with gaps where values are null.
  let line = '';
  let prev: number | null = null;
  values.forEach((v, i) => {
    if (v === null) {
      prev = null;
      return;
    }
    line += `${prev === null ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    prev = v;
  });

  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.v - first.v;
  const deltaLabel = `${delta > 0 ? '+' : ''}${fmt(delta)}${unit ? ` ${unit}` : ''}`;

  const scrub = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (((clientX - rect.left) / rect.width) * W - PAD.l) / (W - PAD.l - PAD.r);
    const i = Math.max(0, Math.min(values.length - 1, Math.round(frac * n)));
    // Snap to nearest non-null point.
    let best = i;
    let bestDist = Infinity;
    for (const p of points) {
      const d = Math.abs(p.i - i);
      if (d < bestDist) {
        bestDist = d;
        best = p.i;
      }
    }
    setCursor(best);
  };

  const tickIdx = [0, Math.floor((values.length - 1) / 2), values.length - 1].filter((v, i, arr) => arr.indexOf(v) === i);
  const yTicks = [lo, (lo + hi) / 2, hi];

  return (
    <div className="trend-card">
      <div className="trend-head">
        <span className="stat-label">{label}</span>
        <span className={`stat-sub trend-delta${delta > 0 ? ' up' : delta < 0 ? ' down' : ''}`}>
          {points.length >= 2 ? deltaLabel : '—'}
        </span>
      </div>
      <svg
        ref={svgRef}
        className="trend-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label} over ${values.length} weeks`}
        onPointerMove={(e) => scrub(e.clientX)}
        onPointerDown={(e) => scrub(e.clientX)}
        onPointerLeave={() => setCursor(null)}
      >
        {yTicks.map((v, i) => (
          <g key={i}>
            <line className="grid" x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} />
            <text className="axis" x={PAD.l - 4} y={y(v) + 3} textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        <path className="trend-line" d={line.trim()} />
        {points.map((p) => (
          <circle key={p.i} className="trend-dot" cx={x(p.i)} cy={y(p.v)} r={2.5} />
        ))}
        {tickIdx.map((i) => (
          <text key={i} className="axis" x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}>
            {fmtWeek(weekStarts[i])}
          </text>
        ))}
        {cursor !== null && values[cursor] !== null && (
          <g>
            <line className="cursor-line" x1={x(cursor)} y1={PAD.t} x2={x(cursor)} y2={H - PAD.b} />
            <circle className="cursor-dot" cx={x(cursor)} cy={y(values[cursor]!)} r={4} />
            <text className="readout" x={W - PAD.r} y={12} textAnchor="end">
              {fmt(values[cursor]!)}
              {unit ? ` ${unit}` : ''} · {fmtWeek(weekStarts[cursor])}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function fmtWeek(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}
