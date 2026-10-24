// Risk over time: high-risk and medium-risk tools per day, drawn as an SVG on
// the server. Each week's point has a tooltip with the exact numbers.

import type { TrendPoint } from "@/lib/store.ts";

const W = 720;
const H = 200;
const PAD = { top: 12, right: 64, bottom: 26, left: 32 };

function fmt(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return null;
  const max = Math.max(4, ...points.map((p) => p.high + p.medium));
  const top = Math.ceil(max / 4) * 4;
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const line = (key: "high" | "medium") => points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  const first = points[0];
  const ticks = [0, top / 2, top];
  const dateTicks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const change = last.high - first.high;
  const span = points.length - 1;
  const ago = `${span} ${span === 1 ? "day" : "days"} ago`;

  return (
    <figure className="trend">
      <figcaption className="sr-only">
        High-risk tools went from {first.high} on {fmt(first.day)} to {last.high} on {fmt(last.day)}. Medium-risk went from {first.medium} to {last.medium}.
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Risk over time">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="trend-grid" />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="trend-axis">{t}</text>
          </g>
        ))}
        {dateTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className="trend-axis">
            {fmt(points[i].day)}
          </text>
        ))}
        <path d={line("medium")} className="trend-line medium" />
        <path d={line("high")} className="trend-line high" />
        <circle cx={x(points.length - 1)} cy={y(last.medium)} r={3.5} className="trend-dot medium" />
        <circle cx={x(points.length - 1)} cy={y(last.high)} r={3.5} className="trend-dot high" />
        <text x={x(points.length - 1) + 8} y={y(last.high) + 4} className="trend-label high">{last.high} high</text>
        <text x={x(points.length - 1) + 8} y={y(last.medium) + (Math.abs(y(last.medium) - y(last.high)) < 14 ? 18 : 4)} className="trend-label medium">{last.medium} medium</text>
        {points.map((p, i) =>
          i % 7 === (points.length - 1) % 7 ? (
            <rect key={p.day} x={x(i) - 6} y={PAD.top} width={12} height={H - PAD.top - PAD.bottom} className="trend-hit">
              <title>{`${fmt(p.day)}: ${p.high} high, ${p.medium} medium, ${p.tools} tools in total`}</title>
            </rect>
          ) : null,
        )}
      </svg>
      <p className="muted small">
        {change < 0
          ? `${-change} fewer high-risk tools than ${ago}.`
          : change > 0
            ? `${change} more high-risk tools than ${ago}.`
            : `Same number of high-risk tools as ${ago}.`}
      </p>
    </figure>
  );
}
