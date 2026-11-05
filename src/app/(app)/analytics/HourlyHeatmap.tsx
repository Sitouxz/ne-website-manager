'use client';

import type { HourlyCell } from '@/lib/analytics/queries';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Postgres dow: 0 = Sunday. Rows are shown Monday-first.
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Page views by day of week × hour of day, in the client's timezone. One
 * hue, light → dark by volume (sequential), with the exact count on hover.
 */
export default function HourlyHeatmap({ cells, tzLabel }: { cells: HourlyCell[]; tzLabel: string }) {
  const grid = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.views]));
  const max = Math.max(1, ...cells.map((c) => c.views));
  const total = cells.reduce((s, c) => s + c.views, 0);

  if (total === 0) {
    return <div style={{ color: 'var(--fg3)', fontSize: 13, padding: '28px 0', textAlign: 'center' }}>No data yet.</div>;
  }

  return (
    <div>
      <div role="table" aria-label={`Page views by weekday and hour (${tzLabel})`} style={{ display: 'grid', gridTemplateColumns: '34px repeat(24, minmax(0, 1fr))', gap: 2, fontSize: 10, color: 'var(--fg3)' }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ textAlign: 'center' }}>{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</div>
        ))}
        {DOW_ORDER.map((dow, i) => (
          <div key={dow} role="row" style={{ display: 'contents' }}>
            <div style={{ alignSelf: 'center', fontWeight: 600 }}>{DAYS[i]}</div>
            {Array.from({ length: 24 }, (_, h) => {
              const v = grid.get(`${dow}:${h}`) ?? 0;
              const share = v / max;
              return (
                <div
                  key={h}
                  role="cell"
                  title={`${DAYS[i]} ${String(h).padStart(2, '0')}:00 – ${v.toLocaleString('en-US')} page view${v === 1 ? '' : 's'}`}
                  style={{
                    height: 16,
                    borderRadius: 3,
                    background: v === 0 ? 'var(--surface-3)' : `color-mix(in srgb, var(--ne-blue) ${Math.round(18 + share * 82)}%, var(--surface))`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, color: 'var(--fg3)' }}>
        <span>Times in {tzLabel}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Fewer
          <span style={{ width: 60, height: 8, borderRadius: 99, background: 'linear-gradient(90deg, color-mix(in srgb, var(--ne-blue) 18%, var(--surface)), var(--ne-blue))' }} />
          More
        </span>
      </div>
    </div>
  );
}
