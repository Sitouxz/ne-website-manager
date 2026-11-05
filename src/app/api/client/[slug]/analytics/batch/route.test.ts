import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { POST } from './route';

const CHROME = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/129.0 Safari/537.36';

function setup() {
  const admin = mockSupabase({
    clients: [{ id: 'c1', slug: 'acme', is_active: true }],
    analytics_events: [],
  });
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return admin;
}

function post(body: unknown, ip = '1.2.3.4', slug = 'acme') {
  return POST(
    new Request(`https://cms.test/api/client/${slug}/analytics/batch`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'user-agent': CHROME, 'x-forwarded-for': ip, 'x-vercel-ip-country': 'SG' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

async function stored(admin: ReturnType<typeof mockSupabase>) {
  const { data } = await admin.from('analytics_events').select('*');
  return data as Record<string, unknown>[];
}

afterEach(() => vi.clearAllMocks());

describe('POST /analytics/batch', () => {
  it('stores every valid event in one insert', async () => {
    const admin = setup();
    const res = await post({ events: [
      { event_name: 'page_view', path: '/', tv: 3, is_entry: true },
      { event_name: 'page_leave', path: '/', tv: 3, engaged_ms: 4200, scroll_pct: 60 },
    ] }, '10.0.0.1');
    expect(res.status).toBe(200);
    const rows = await stored(admin);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ event_name: 'page_leave', engaged_ms: 4200, scroll_pct: 60, country: 'SG', client_id: 'c1' });
  });

  it('accepts a bare array and caps a batch at 20 events', async () => {
    const admin = setup();
    await post(Array.from({ length: 30 }, () => ({ path: '/x' })), '10.0.0.2');
    expect(await stored(admin)).toHaveLength(20);
  });

  it('returns 204 and stores nothing for malformed bodies', async () => {
    const admin = setup();
    expect((await post('{nope', '10.0.0.3')).status).toBe(204);
    expect((await post({ foo: 1 }, '10.0.0.3')).status).toBe(204);
    expect((await post({ events: [null, 5] }, '10.0.0.3')).status).toBe(204);
    expect(await stored(admin)).toHaveLength(0);
  });

  it('404s for an unknown client', async () => {
    setup();
    expect((await post({ events: [{}] }, '10.0.0.4', 'nope')).status).toBe(404);
  });

  it('rate-limits at 60 batches per minute per IP and client', async () => {
    const admin = setup();
    for (let i = 0; i < 60; i++) await post({ events: [{}] }, '10.0.0.5');
    const res = await post({ events: [{}] }, '10.0.0.5');
    expect(res.status).toBe(204);
    expect(await stored(admin)).toHaveLength(60);
  });
});
