import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET, POST } from './route';

type Fixtures = Record<string, unknown[]>;
type MockUser = { id: string } | null;

function supabaseFor(user: MockUser, fixtures: Fixtures) {
  const base = mockSupabase(fixtures);
  return {
    ...base,
    auth: {
      getUser: async () => ({ data: { user } }),
    },
  };
}

function setSupabase(supabase: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
}

function setAdmin(fixtures: Fixtures = {}) {
  const admin = mockSupabase(fixtures);
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return admin;
}

const USER = { id: 'user-1' };

function getReq(query: string) {
  return new Request(`https://example.com/api/cms/revisions${query}`);
}

function postReq(body: unknown) {
  return new Request('https://example.com/api/cms/revisions', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/cms/revisions', () => {
  it('returns 401 when unauthenticated', async () => {
    setSupabase(supabaseFor(null, { revisions: [] }));
    setAdmin();

    const res = await GET(getReq('?entity_type=post&entity_id=post-1'));

    expect(res.status).toBe(401);
  });

  it('returns 400 when entity_type or entity_id is missing', async () => {
    setSupabase(supabaseFor(USER, { revisions: [] }));
    setAdmin();

    const res = await GET(getReq('?entity_type=post'));

    expect(res.status).toBe(400);
  });

  it('returns revisions for the entity, newest first, excluding other entities', async () => {
    setSupabase(
      supabaseFor(USER, {
        revisions: [
          { id: 'r1', client_id: 'c1', entity_type: 'post', entity_id: 'post-1', snapshot: { title: 'v1' }, author_id: 'user-1', created_at: '2026-01-01T00:00:00Z' },
          { id: 'r2', client_id: 'c1', entity_type: 'post', entity_id: 'post-1', snapshot: { title: 'v2' }, author_id: 'user-1', created_at: '2026-01-02T00:00:00Z' },
          { id: 'r3', client_id: 'c1', entity_type: 'post', entity_id: 'post-OTHER', snapshot: { title: 'other' }, author_id: 'user-1', created_at: '2026-01-03T00:00:00Z' },
        ],
      })
    );
    setAdmin({ profiles: [{ id: 'user-1', full_name: 'Alice' }] });

    const res = await GET(getReq('?entity_type=post&entity_id=post-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.map((r: { id: string }) => r.id)).toEqual(['r2', 'r1']);
    expect(body[0].author_name).toBe('Alice');
  });
});

describe('POST /api/cms/revisions', () => {
  it('returns 401 when unauthenticated', async () => {
    setSupabase(supabaseFor(null, { revisions: [], posts: [] }));
    setAdmin();

    const res = await POST(postReq({ entity_type: 'post', entity_id: 'post-1', revision_id: 'r1' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 for an unsupported entity_type', async () => {
    setSupabase(supabaseFor(USER, { revisions: [], posts: [] }));
    setAdmin();

    const res = await POST(postReq({ entity_type: 'property', entity_id: 'property-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/not yet supported/i);
  });

  it('returns 404 when the revision_id does not resolve to a visible row', async () => {
    setSupabase(supabaseFor(USER, { revisions: [], posts: [{ id: 'post-1', client_id: 'c1', title: 'Current' }] }));
    setAdmin();

    const res = await POST(postReq({ entity_type: 'post', entity_id: 'post-1', revision_id: 'missing' }));

    expect(res.status).toBe(404);
  });

  it('restores the snapshot onto the live post row, snapshots the pre-restore state first, and returns the restored row', async () => {
    const supabase = supabaseFor(USER, {
      posts: [{
        id: 'post-1', client_id: 'c1', title: 'Current Title', slug: 'current-title',
        excerpt: 'current excerpt', content: '<p>current</p>', content_json: null,
        category: 'Worship', tags: ['a'], status: 'draft', cover_url: null,
        seo_title: null, seo_description: null, scheduled_at: null, published_at: null,
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'post', entity_id: 'post-1',
        snapshot: { title: 'Old Title', slug: 'old-title', excerpt: 'old excerpt', content: '<p>old</p>', content_json: null, category: 'Worship', tags: ['b'], status: 'draft', cover_url: null, seo_title: null, seo_description: null, scheduled_at: null, published_at: null },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'post', entity_id: 'post-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('Old Title');
    expect(body.tags).toEqual(['b']);

    // Pre-restore snapshot of the CURRENT (pre-restore) row was inserted.
    const { data: revisionRows } = await supabase.from('revisions').select('*');
    expect(revisionRows).toHaveLength(2);
    const preRestoreSnapshot = (revisionRows as Array<{ id: string; snapshot: { title: string } }>).find((r) => r.id !== 'r1');
    expect(preRestoreSnapshot?.snapshot.title).toBe('Current Title');

    // Live row was actually updated.
    const { data: postRows } = await supabase.from('posts').select('*').eq('id', 'post-1').single();
    expect(postRows?.title).toBe('Old Title');
  });

  it('returns 404 for a page when the revision_id does not resolve to a visible row', async () => {
    setSupabase(supabaseFor(USER, { revisions: [], pages: [{ id: 'page-1', client_id: 'c1', title: 'Current' }] }));
    setAdmin();

    const res = await POST(postReq({ entity_type: 'page', entity_id: 'page-1', revision_id: 'missing' }));

    expect(res.status).toBe(404);
  });

  it('returns 404 for a page when the page itself does not exist', async () => {
    setSupabase(supabaseFor(USER, {
      pages: [],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'page', entity_id: 'page-1',
        snapshot: { title: 'Old Title' }, author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    }));
    setAdmin();

    const res = await POST(postReq({ entity_type: 'page', entity_id: 'page-1', revision_id: 'r1' }));

    expect(res.status).toBe(404);
  });

  it('restores the snapshot onto the live page row (not the posts table), snapshots the pre-restore state first, and returns the restored row', async () => {
    const supabase = supabaseFor(USER, {
      pages: [{
        id: 'page-1', client_id: 'c1', title: 'Current Title', path: '/current-title',
        content: '<p>current</p>', content_json: null, status: 'draft', visibility: 'public',
        seo_title: null, seo_description: null,
      }],
      posts: [{
        id: 'post-1', client_id: 'c1', title: 'Unrelated post', slug: 'unrelated',
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'page', entity_id: 'page-1',
        snapshot: {
          title: 'Old Title', path: '/old-title', content: '<p>old</p>', content_json: null,
          status: 'draft', visibility: 'private', seo_title: null, seo_description: null,
        },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'page', entity_id: 'page-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('Old Title');
    expect(body.path).toBe('/old-title');
    expect(body.visibility).toBe('private');

    // Pre-restore snapshot of the CURRENT (pre-restore) page row was inserted.
    const { data: revisionRows } = await supabase.from('revisions').select('*');
    expect(revisionRows).toHaveLength(2);
    const preRestoreSnapshot = (revisionRows as Array<{ id: string; entity_type: string; snapshot: { title: string } }>).find((r) => r.id !== 'r1');
    expect(preRestoreSnapshot?.entity_type).toBe('page');
    expect(preRestoreSnapshot?.snapshot.title).toBe('Current Title');

    // Live page row was actually updated — via the `pages` table, not `posts`.
    const { data: pageRows } = await supabase.from('pages').select('*').eq('id', 'page-1').single();
    expect(pageRows?.title).toBe('Old Title');
    expect(pageRows?.path).toBe('/old-title');

    // The unrelated post row was untouched.
    const { data: postRows } = await supabase.from('posts').select('*').eq('id', 'post-1').single();
    expect(postRows?.title).toBe('Unrelated post');
  });
});
