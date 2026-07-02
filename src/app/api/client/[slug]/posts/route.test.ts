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
  return new Request(`https://example.com/api/client/acme/posts${query}`);
}

const params = Promise.resolve({ slug: 'acme' });

const CLIENT = { id: 'client-1', slug: 'acme' };

/** 12 published posts for client-1, published_at strictly increasing p1 (oldest) -> p12 (newest). */
const PUBLISHED_POSTS = Array.from({ length: 12 }, (_, i) => ({
  id: `p${i + 1}`,
  client_id: 'client-1',
  title: `Post ${i + 1}`,
  slug: `post-${i + 1}`,
  excerpt: 'excerpt',
  content: 'content',
  cover_url: null,
  category: i % 2 === 0 ? 'news' : 'events',
  tags: [],
  status: 'published',
  seo_title: null,
  seo_description: null,
  published_at: `2024-01-${String(i + 1).padStart(2, '0')}`,
  created_at: `2024-01-${String(i + 1).padStart(2, '0')}`,
  updated_at: `2024-01-${String(i + 1).padStart(2, '0')}`,
}));

const DRAFT_POST = {
  id: 'draft-1',
  client_id: 'client-1',
  title: 'Unpublished draft',
  slug: 'draft',
  excerpt: 'excerpt',
  content: 'content',
  cover_url: null,
  category: 'news',
  tags: [],
  status: 'draft',
  seo_title: null,
  seo_description: null,
  published_at: '2099-01-01', // deliberately "newest" to prove drafts are excluded regardless of order
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

const OTHER_CLIENT_POST = {
  id: 'other-1',
  client_id: 'client-2',
  title: 'Other client post',
  slug: 'other-post',
  excerpt: 'excerpt',
  content: 'content',
  cover_url: null,
  category: 'news',
  tags: [],
  status: 'published',
  seo_title: null,
  seo_description: null,
  published_at: '2024-06-01',
  created_at: '2024-06-01',
  updated_at: '2024-06-01',
};

function fixtures() {
  return {
    clients: [CLIENT],
    posts: [...PUBLISHED_POSTS, DRAFT_POST, OTHER_CLIENT_POST],
  };
}

describe('GET /api/client/[slug]/posts — backward compatibility', () => {
  it('with no limit/offset params, returns exactly the pre-pagination shape: published-only, own-client-only, newest-first, all matching rows', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    // Only the 12 published client-1 posts — the draft and the other client's
    // post are excluded regardless of their published_at value.
    expect(body).toHaveLength(12);
    expect(body.every((p: { status: string }) => p.status === 'published')).toBe(true);
    expect(body.some((p: { id: string }) => p.id === 'draft-1')).toBe(false);
    expect(body.some((p: { id: string }) => p.id === 'other-1')).toBe(false);

    // Newest published_at first.
    expect(body[0].id).toBe('p12');
    expect(body[11].id).toBe('p1');

    // Column selection: every documented public column is present. (The
    // in-memory mock doesn't implement real column projection — it always
    // returns the full stored fixture row regardless of the `.select(...)`
    // argument — so this can't also assert that *no other* column is
    // returned; that part of the guarantee is enforced by Postgrest itself
    // against the real DB, not by this mock.)
    const expectedColumns = [
      'id', 'title', 'slug', 'excerpt', 'content', 'cover_url', 'category',
      'tags', 'status', 'seo_title', 'seo_description', 'published_at',
      'created_at', 'updated_at',
    ];
    for (const column of expectedColumns) {
      expect(body[0]).toHaveProperty(column);
    }
  });

  it('X-Total-Count reflects the full published-post count for the client with no params', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq(), { params });

    expect(res.headers.get('X-Total-Count')).toBe('12');
  });
});

describe('GET /api/client/[slug]/posts — pagination', () => {
  it('limit/offset change which rows come back', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq('?limit=5&offset=0'), { params });
    const body = await res.json();

    expect(body).toHaveLength(5);
    expect(body.map((p: { id: string }) => p.id)).toEqual(['p12', 'p11', 'p10', 'p9', 'p8']);

    const res2 = await GET(getReq('?limit=5&offset=5'), { params });
    const body2 = await res2.json();

    expect(body2).toHaveLength(5);
    expect(body2.map((p: { id: string }) => p.id)).toEqual(['p7', 'p6', 'p5', 'p4', 'p3']);
  });

  it('X-Total-Count reflects the full matching count, not just the returned page size', async () => {
    setSupabase(mockSupabase(fixtures()));

    const res = await GET(getReq('?limit=3&offset=0'), { params });
    const body = await res.json();

    expect(body).toHaveLength(3);
    expect(res.headers.get('X-Total-Count')).toBe('12');
  });

  it('applies the category filter to both the page and the total count', async () => {
    setSupabase(mockSupabase(fixtures()));

    // 6 of the 12 published posts are category "news" (even-indexed i=0,2,4,6,8,10 -> posts 1,3,5,7,9,11).
    const res = await GET(getReq('?category=news'), { params });
    const body = await res.json();

    expect(body.every((p: { category: string }) => p.category === 'news')).toBe(true);
    expect(body).toHaveLength(6);
    expect(res.headers.get('X-Total-Count')).toBe('6');
  });
});

describe('GET /api/client/[slug]/posts — misc', () => {
  it('returns 404 when the client slug does not exist', async () => {
    setSupabase(mockSupabase({ clients: [], posts: [] }));

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(404);
  });
});
