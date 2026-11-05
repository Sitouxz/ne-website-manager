'use client';

import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { SeriesPoint } from '@/lib/analytics/queries';
import { fmtNumber, fmtPct, pctChange } from '@/lib/analytics/metrics';

export type TrendMetric = 'views' | 'visitors' | 'sessions';

export const TREND_METRICS: { id: TrendMetric; label: string }[] = [
  { id: 'views', label: 'Page views' },
  { id: 'visitors', label: 'Visitors' },
  { id: 'sessions', label: 'Sessions' },
];

type Row = { label: string; value: number; previous: number | null; previousLabel: string | null; point: SeriesPoint };

/**
 * Trend chart for the Analytics screen: one bar per bucket for the selected
 * metric, plus a dashed line for the comparison period aligned bucket-by-
 * bucket (bucket 1 of the previous period under bucket 1 of this one). One
 * axis, one measure. Hovering shows the exact values; clicking a bar drills
 * into that bucket's dates.
 */
export default function TrendChart({
  points, previous, metric, onSelect, canDrill,
}: {
  points: SeriesPoint[];
  previous: SeriesPoint[] | null;
  metric: TrendMetric;
  onSelect?: (point: SeriesPoint) => void;
  canDrill: (point: SeriesPoint) => boolean;
}) {
  const rows: Row[] = points.map((point, i) => {
    const prev = previous?.[i];
    return {
      label: point.label,
      value: point[metric],
      previous: prev ? prev[metric] : null,
      previousLabel: prev ? prev.label : null,
      point,
    };
  });
  const metricLabel = TREND_METRICS.find((m) => m.id === metric)?.label ?? metric;
  const dense = rows.length > 45;

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap={dense ? 1 : '18%'}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10.5, fill: 'var(--fg3)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            interval="preserveStartEnd"
            minTickGap={18}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: 'var(--fg3)' }} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            cursor={{ fill: 'var(--surface-3)', opacity: 0.6 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Row;
              const delta = pctChange(row.value, row.previous);
              return (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', boxShadow: 'var(--shadow-sm)', fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: 'var(--fg1)', marginBottom: 4 }}>{row.label}</div>
                  <div style={{ color: 'var(--fg2)' }}>{metricLabel}: <b style={{ color: 'var(--fg1)' }}>{fmtNumber(row.value)}</b></div>
                  {row.previous !== null && (
                    <div style={{ color: 'var(--fg3)', marginTop: 2 }}>
                      {row.previousLabel}: {fmtNumber(row.previous)}
                      {delta !== null && <span> ({delta >= 0 ? '+' : ''}{fmtPct(delta, 0)})</span>}
                    </div>
                  )}
                  {onSelect && canDrill(row.point) && <div style={{ color: 'var(--fg3)', marginTop: 4, fontSize: 11 }}>Click to drill in</div>}
                </div>
              );
            }}
          />
          <Bar
            dataKey="value"
            name={metricLabel}
            fill="var(--ne-blue)"
            radius={dense ? [2, 2, 0, 0] : [4, 4, 0, 0]}
            isAnimationActive={false}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={(_data, index) => {
              const row = rows[index];
              if (row && onSelect && canDrill(row.point)) onSelect(row.point);
            }}
          />
          {previous && (
            <Line
              dataKey="previous"
              name="Comparison period"
              type="monotone"
              stroke="var(--fg3)"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
