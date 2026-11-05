import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Render test for the Analytics screen with a stubbed Supabase client: the
 * RPC results drive the tiles, legacy-tracker data shows "Needs tracker v3"
 * (never a misleading 0) plus the upgrade banner, and comparison deltas use
 * the previous-period overview.
 */

const overviews: Record<string, unknown>[] = [];
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

function chain(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'gte', 'lt', 'order', 'limit']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return q;
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => chain(table === 'clients'
      ? [{ id: 'c1', blog_path: '/blog', timezone: 'Asia/Singapore' }]
      : []),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'analytics_overview') return Promise.resolve({ data: overviews.shift() ?? {}, error: null });
      if (fn === 'analytics_breakdown') {
        return Promise.resolve({ data: args.p_dimension === 'referrer' ? [{ name: 'google.com', count: 5, visitors: 4, sessions: 5 }] : [], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));
vi.mock('@/components/AppShell', () => ({ useSelectedClient: () => ({ selectedClientId: 'c1', clientName: 'Zhenghe' }) }));
vi.mock('@/components/Topbar', () => ({ default: () => null }));

import AnalyticsPage from './page';

const legacy = { page_views: 182, visitors: 113, sessions: 134, custom_events: 0, event_types: 0, measured_sessions: 0, engaged_sessions: 0, total_engaged_ms: 0, measured_visitors: 0, new_visitors: 0, conversions: 0, tracker_version: null };

describe('Analytics page', () => {
  it('shows RPC numbers, deltas vs the previous period, and "needs tracker v3" for legacy data', async () => {
    overviews.push(legacy, { ...legacy, page_views: 91 });
    render(<AnalyticsPage />);

    await waitFor(() => expect(screen.getByText('182')).toBeTruthy());
    expect(screen.getByText('113')).toBeTruthy();
    // Page views 182 vs 91, and pages/session follows (same sessions).
    expect(screen.getAllByText('+100%')).toHaveLength(2);
    expect(screen.getAllByText('Needs tracker v3')).toHaveLength(3);
    expect(screen.getByText(/This site runs an older tracker/)).toBeTruthy();
    expect(screen.getByText('google.com')).toBeTruthy();

    // Every RPC is scoped to the client and bucketed in its timezone.
    const series = rpcCalls.find((c) => c.fn === 'analytics_timeseries')!;
    expect(series.args).toMatchObject({ p_client: 'c1', p_tz: 'Asia/Singapore', p_granularity: 'day' });
    const ov = rpcCalls.find((c) => c.fn === 'analytics_overview')!;
    expect(new Date(ov.args.p_from as string).getUTCHours()).toBe(16); // SGT midnight
  });

  it('shows engagement metrics once v3 data exists', async () => {
    overviews.length = 0;
    overviews.push(
      { ...legacy, tracker_version: 3, measured_sessions: 134, engaged_sessions: 67, total_engaged_ms: 134 * 45_000, measured_visitors: 100, new_visitors: 80 },
      legacy,
    );
    render(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByText('50.0%')).toBeTruthy());
    expect(screen.getByText('45s')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.queryByText(/older tracker/)).toBeNull();
    expect(screen.getByText(/Tracker v3 — up to date/)).toBeTruthy();
  });
});
