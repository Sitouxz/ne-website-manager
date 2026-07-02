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
  return new Request(`https://example.com/api/client/acme/pages${query}`);
}

const params = Promise.resolve({ slug: 'acme' });

const CLIENT = { id: 'client-1', slug: 'acme' };

/**
 * 150 published, public pages for client-1 — deliberately more than the
 * route's `defaultLimit`/`maxLimit` (100), because this route's whole point
 * is that a no-params request is *unbounded*, unlike posts/properties.
 */
const PUBLIC_PAGES = Array.from({ length: 150 }, (_, i) => ({
  id: `page-${i + 1}`,
  client_id: 'client-1',
  title: `Page ${i + 1}`,
  path: `/page-${String(i + 1).padStart(3, '0')}`,
  content: 'content',
  status: 'published',
  visibility: 'public',
  updated_at: '2024-01-01',
}));

const DRAFT_PAGE = {
  id: 'draft-page',
  client_id: 'client-1',
  title: 'Draft page',
  path: '/draft',
  content: 'content',
  status: 'draft',
  visibility: 'public',
  updated_at: '2024-01-01',
};

const PRIVATE_PAGE = {
  id: 'private-page',
  client_id: 'client-1',
  title: 'Private page',
  path: '/private',
  content: 'content',
  status: 'published',
  visibility: 'private',
  updated_at: '2024-01-01',
};

const OTHER_CLIENT_PAGE = {
  id: 'other-page',
  client_id: 'client-2',
  title: 'Other client page',
  path: '/other',
  content: 'content',
  status: 'published',
  visibility: 'public',
  updated_at: '2024-01-01',
};

function fixtures() {
  return {
    clients: [CLIENT],
    pages: [...PUBLIC_PAGES, DRAFT_PAGE, PRIVATE_PAGE, OTHER_CLIENT_PAGE],
  };
}

describe('GET /api/client/[slug]/pages — backward compatibility', () => {
  it('with no limit/offset params, returns every matching page unbounded (no 100-row cap), published+public+own-client only, ordered by path', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    // All 150 published+public client-1 pages come back — this route
    // historically applied no cap at all when called with no params, and
    // that must still hold now that pagination support exists.
    expect(body).toHaveLength(150);
    expect(body.some((p: { id: string }) => p.id === 'draft-page')).toBe(false);
    expect(body.some((p: { id: string }) => p.id === 'private-page')).toBe(false);
    expect(body.some((p: { id: string }) => p.id === 'other-page')).toBe(false);

    // Ordered by path ascending.
    const paths = body.map((p: { path: string }) => p.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths[0]).toBe('/page-001');
    expect(paths[paths.length - 1]).toBe('/page-150');
  });

  it('X-Total-Count reflects the full matching count with no params', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });

    expect(res.headers.get('X-Total-Count')).toBe('150');
  });
});

describe('GET /api/client/[slug]/pages — pagination', () => {
  it('supplying limit/offset opts into a bounded page, changing which rows come back', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq('?limit=5&offset=0'), { params });
    const body = await res.json();

    expect(body).toHaveLength(5);
    expect(body.map((p: { path: string }) => p.path)).toEqual([
      '/page-001', '/page-002', '/page-003', '/page-004', '/page-005',
    ]);

    const res2 = await GET(getReq('?limit=5&offset=5'), { params });
    const body2 = await res2.json();

    expect(body2.map((p: { path: string }) => p.path)).toEqual([
      '/page-006', '/page-007', '/page-008', '/page-009', '/page-010',
    ]);
  });

  it('X-Total-Count reflects the full matching count, not just the returned page size', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq('?limit=3&offset=0'), { params });
    const body = await res.json();

    expect(body).toHaveLength(3);
    expect(res.headers.get('X-Total-Count')).toBe('150');
  });
});

describe('GET /api/client/[slug]/pages — misc', () => {
  it('returns 404 when the client slug does not exist', async () => {
    setSupabase(mockSupabase({ clients: [], pages: [] }));

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(404);
  });
});
