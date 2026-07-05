import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { GET } from './route';

type Fixtures = Record<string, unknown[]>;

function setAdmin(fixtures: Fixtures = {}) {
  const admin = mockSupabase(fixtures);
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return { admin };
}

function getReq(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/cron/rollup-analytics', { headers });
}

const DAY_MS = 86_400_000;

// A fixed "now" well inside the cron's re-aggregation window (yesterday +
// today), used so fixtures don't depend on the actual wall-clock date.
const NOW = new Date();
const TODAY = NOW.toISOString().slice(0, 10);

function pageView(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    client_id: 'client-1',
    event_name: 'page_view',
    path: '/blog/hello-world',
    visitor_id: 'visitor-a',
    created_at: NOW.toISOString(),
    ...overrides,
  };
}

async function rollupRows(admin: ReturnType<typeof mockSupabase>) {
  const { data } = await admin.from('analytics_daily').select('*');
  return data as Array<Record<string, unknown>>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/cron/rollup-analytics — auth', () => {
  it('returns 401 and writes nothing when the Authorization header is missing', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const { admin } = setAdmin({ analytics_events: [pageView()] });

    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(await rollupRows(admin)).toEqual([]);
  });

  it('returns 401 and writes nothing when the Authorization header is wrong', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const { admin } = setAdmin({ analytics_events: [pageView()] });

    const res = await GET(getReq({ authorization: 'Bearer wrong-secret' }));

    expect(res.status).toBe(401);
    expect(await rollupRows(admin)).toEqual([]);
  });

  it('returns 401 (never a false-accept) when CRON_SECRET is unset on the server, even with a header sent', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { admin } = setAdmin({ analytics_events: [pageView()] });

    const res = await GET(getReq({ authorization: 'Bearer ' }));

    expect(res.status).toBe(401);
    expect(await rollupRows(admin)).toEqual([]);
  });

  it('returns 401 when CRON_SECRET is unset and no header is sent at all', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { admin } = setAdmin({ analytics_events: [pageView()] });

    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(await rollupRows(admin)).toEqual([]);
  });
});

describe('GET /api/cron/rollup-analytics — aggregation', () => {
  it('aggregates views (event count) and visitors (distinct visitor_id count) for a path/day', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const { admin } = setAdmin({
      analytics_events: [
        pageView({ visitor_id: 'visitor-a' }),
        pageView({ visitor_id: 'visitor-a' }), // same visitor, same path/day -> counts once toward visitors
        pageView({ visitor_id: 'visitor-b' }),
      ],
    });

    const res = await GET(getReq({ authorization: 'Bearer correct-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.aggregated).toBe(1);

    const rows = await rollupRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      client_id: 'client-1',
      day: TODAY,
      path: '/blog/hello-world',
      views: 3,
      visitors: 2,
    });
  });

  it('excludes non-page_view events from the rollup', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const { admin } = setAdmin({
      analytics_events: [
        pageView(),
        pageView({ event_name: 'contact_click', path: '/contact', visitor_id: 'visitor-c' }),
        pageView({ event_name: 'form_submit', path: '/contact', visitor_id: 'visitor-d' }),
      ],
    });

    const res = await GET(getReq({ authorization: 'Bearer correct-secret' }));
    const body = await res.json();

    expect(body.aggregated).toBe(1);
    const rows = await rollupRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/blog/hello-world');
    expect(rows[0].views).toBe(1);
  });

  it('keeps separate rollup rows per distinct client_id/day/path grouping', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    setAdmin({
      analytics_events: [
        pageView({ client_id: 'client-1', path: '/blog/a', visitor_id: 'v1' }),
        pageView({ client_id: 'client-1', path: '/blog/b', visitor_id: 'v1' }),
        pageView({ client_id: 'client-2', path: '/blog/a', visitor_id: 'v2' }),
      ],
    });

    const res = await GET(getReq({ authorization: 'Bearer correct-secret' }));
    const body = await res.json();

    expect(body.aggregated).toBe(3);
  });

  it('excludes page_view events older than the 2-day re-aggregation window', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const stale = new Date(NOW.getTime() - 10 * DAY_MS).toISOString();
    const { admin } = setAdmin({
      analytics_events: [
        pageView({ visitor_id: 'visitor-a' }),
        pageView({ visitor_id: 'visitor-b', created_at: stale, path: '/blog/old-post' }),
      ],
    });

    await GET(getReq({ authorization: 'Bearer correct-secret' }));

    const rows = await rollupRows(admin);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/blog/hello-world');
  });

  it('upserts into an existing rollup row rather than duplicating it', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const { admin } = setAdmin({
      analytics_daily: [
        { id: 'existing-1', client_id: 'client-1', day: TODAY, path: '/blog/hello-world', views: 10, visitors: 5 },
      ],
      analytics_events: [
        pageView({ visitor_id: 'visitor-a' }),
        pageView({ visitor_id: 'visitor-b' }),
      ],
    });

    await GET(getReq({ authorization: 'Bearer correct-secret' }));

    const rows = await rollupRows(admin);
    expect(rows).toHaveLength(1); // updated in place, not duplicated
    expect(rows[0]).toMatchObject({ id: 'existing-1', views: 2, visitors: 2 });
  });

  it('returns aggregated: 0 and never writes when there are no page_view events', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const { admin } = setAdmin({
      analytics_events: [pageView({ event_name: 'contact_click' })],
    });

    const res = await GET(getReq({ authorization: 'Bearer correct-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.aggregated).toBe(0);
    expect(await rollupRows(admin)).toEqual([]);
  });
});
