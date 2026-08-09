import { useRef, useState } from 'react';
import type { ImportedBlock } from '@climb/engine';

const W = 320;
const H = 116;
const PAD = { l: 30, r: 8, t: 18, b: 16 };

export function HrChart({ series, avgHr, blocks }: { series: number[]; avgHr: number | null; blocks?: ImportedBlock[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  if (series.length < 2) return null;

  const lo = Math.floor((Math.min(...series) - 4) / 10) * 10;
  const hi = Math.ceil((Math.max(...series) + 4) / 10) * 10;
  const x = (i: number) => PAD.l + (i / (series.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(series.length - 1).toFixed(1)} ${y(lo).toFixed(1)} L${x(0).toFixed(1)} ${y(lo).toFixed(1)} Z`;
  const mid = Math.round((lo + hi) / 2 / 5) * 5;

  const scrub = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = (((clientX - rect.left) / rect.width) * W - PAD.l) / (W - PAD.l - PAD.r);
    setCursor(Math.max(0, Math.min(series.length - 1, Math.round(frac * (series.length - 1)))));
  };

  return (
    <svg
      ref={svgRef}
      className="hr-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Heart rate by minute, ${lo} to ${hi} bpm`}
      onPointerMove={(e) => scrub(e.clientX)}
      onPointerDown={(e) => scrub(e.clientX)}
      onPointerLeave={() => setCursor(null)}
    >
      {(blocks ?? [])
        .filter((b) => b.kind === 'climb')
        .map((b, i) => {
          const clamp = (m: number) => Math.max(0, Math.min(series.length - 1, m));
          const x1 = x(clamp(b.startSec / 60));
          const x2 = x(clamp((b.startSec + b.durationSec) / 60));
          if (x2 - x1 < 1) return null;
          return <rect key={i} className="climb-band" x={x1} y={PAD.t} width={x2 - x1} height={H - PAD.t - PAD.b} />;
        })}
      {[lo, mid, hi].map((v) => (
        <g key={v}>
          <line className="grid" x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)} />
          <text className="axis" x={PAD.l - 4} y={y(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <path className="hr-area" d={area} />
      <path className="hr-line" d={line} />
      {avgHr !== null && avgHr > lo && avgHr < hi && (
        <g>
          <line className="avg-line" x1={PAD.l} y1={y(avgHr)} x2={W - PAD.r} y2={y(avgHr)} />
          <text className="axis" x={W - PAD.r} y={y(avgHr) - 3} textAnchor="end">
            AVG {avgHr}
          </text>
        </g>
      )}
      <text className="axis" x={PAD.l} y={H - 4}>
        0
      </text>
      <text className="axis" x={W - PAD.r} y={H - 4} textAnchor="end">
        {series.length - 1} MIN
      </text>
      {cursor !== null && (
        <g>
          <line className="cursor-line" x1={x(cursor)} y1={PAD.t} x2={x(cursor)} y2={H - PAD.b} />
          <circle className="cursor-dot" cx={x(cursor)} cy={y(series[cursor])} r={4} />
          <text className="readout" x={W - PAD.r} y={12} textAnchor="end">
            {series[cursor]} BPM · MIN {cursor}
          </text>
        </g>
      )}
    </svg>
  );
}
