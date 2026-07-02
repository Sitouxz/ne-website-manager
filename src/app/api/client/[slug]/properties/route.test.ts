import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

function setSupabase(supabase: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
}

function getReq(query = ''): Request {
  return new Request(`https://example.com/api/client/acme/properties${query}`);
}

const params = Promise.resolve({ slug: 'acme' });

const CLIENT = { id: 'client-1', slug: 'acme' };

/** 12 active properties for client-1, created_at strictly increasing r1 (oldest) -> r12 (newest). */
const ACTIVE_PROPERTIES = Array.from({ length: 12 }, (_, i) => ({
  id: `r${i + 1}`,
  client_id: 'client-1',
  title: `Property ${i + 1}`,
  status: 'active',
  listing: i % 2 === 0 ? 'sale' : 'rent',
  created_at: `2024-01-${String(i + 1).padStart(2, '0')}`,
}));

const SOLD_PROPERTY = {
  id: 'sold-1',
  client_id: 'client-1',
  title: 'Sold property',
  status: 'sold',
  listing: 'sale',
  created_at: '2099-01-01', // deliberately "newest" to prove non-active rows are excluded regardless of order
};

const OTHER_CLIENT_PROPERTY = {
  id: 'other-1',
  client_id: 'client-2',
  title: 'Other client property',
  status: 'active',
  listing: 'sale',
  created_at: '2024-06-01',
};

function fixtures() {
  return {
    clients: [CLIENT],
    properties: [...ACTIVE_PROPERTIES, SOLD_PROPERTY, OTHER_CLIENT_PROPERTY],
  };
}

describe('GET /api/client/[slug]/properties — backward compatibility', () => {
  it('with no limit/offset params, returns exactly the pre-pagination shape: active-only, own-client-only, newest-first, all matching rows', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(12);
    expect(body.every((p: { status: string }) => p.status === 'active')).toBe(true);
    expect(body.some((p: { id: string }) => p.id === 'sold-1')).toBe(false);
    expect(body.some((p: { id: string }) => p.id === 'other-1')).toBe(false);

    // Newest created_at first.
    expect(body[0].id).toBe('r12');
    expect(body[11].id).toBe('r1');
  });

  it('X-Total-Count reflects the full active-property count for the client with no params', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });

    expect(res.headers.get('X-Total-Count')).toBe('12');
  });
});

describe('GET /api/client/[slug]/properties — pagination', () => {
  it('limit/offset change which rows come back', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq('?limit=5&offset=5'), { params });
    const body = await res.json();

    expect(body).toHaveLength(5);
    expect(body.map((p: { id: string }) => p.id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3']);
  });

  it('X-Total-Count reflects the full matching count, not just the returned page size', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq('?limit=3&offset=0'), { params });
    const body = await res.json();

    expect(body).toHaveLength(3);
    expect(res.headers.get('X-Total-Count')).toBe('12');
  });

  it('applies the listing filter to both the page and the total count', async () => {
    setSupabase(mockSupabase(fixtures()));

    // 6 of the 12 active properties are listing "sale" (even-indexed i=0,2,4,6,8,10 -> r1,r3,r5,r7,r9,r11).
    const res = await GET(getReq('?listing=sale'), { params });
    const body = await res.json();

    expect(body.every((p: { listing: string }) => p.listing === 'sale')).toBe(true);
    expect(body).toHaveLength(6);
    expect(res.headers.get('X-Total-Count')).toBe('6');
  });
});

describe('GET /api/client/[slug]/properties — misc', () => {
  it('returns 404 when the client slug does not exist', async () => {
    setSupabase(mockSupabase({ clients: [], properties: [] }));

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(404);
  });
});
