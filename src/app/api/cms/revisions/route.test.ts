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

  it('returns 404 for a collection entry when the revision_id does not resolve to a visible row', async () => {
    setSupabase(supabaseFor(USER, { revisions: [], collection_items: [{ id: 'entry-1', client_id: 'c1', slug: 'current' }] }));
    setAdmin();

    const res = await POST(postReq({ entity_type: 'collection_entry', entity_id: 'entry-1', revision_id: 'missing' }));

    expect(res.status).toBe(404);
  });

  it('restores the snapshot onto the live collection_items row, snapshots the pre-restore state first, and returns the restored row', async () => {
    const supabase = supabaseFor(USER, {
      collection_items: [{
        id: 'entry-1', client_id: 'c1', collection_id: 'coll-1', slug: 'current-slug',
        status: 'draft', data: { title: 'Current' }, sort_order: 0, published_at: null,
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'collection_entry', entity_id: 'entry-1',
        snapshot: { slug: 'old-slug', status: 'published', data: { title: 'Old' }, published_at: '2026-01-01T00:00:00Z' },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'collection_entry', entity_id: 'entry-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.slug).toBe('old-slug');
    expect(body.status).toBe('published');
    expect(body.data).toEqual({ title: 'Old' });

    // Pre-restore snapshot of the CURRENT (pre-restore) row was inserted.
    const { data: revisionRows } = await supabase.from('revisions').select('*');
    expect(revisionRows).toHaveLength(2);
    const preRestoreSnapshot = (revisionRows as Array<{ id: string; entity_type: string; snapshot: { data: { title: string } } }>).find((r) => r.id !== 'r1');
    expect(preRestoreSnapshot?.entity_type).toBe('collection_entry');
    expect(preRestoreSnapshot?.snapshot.data.title).toBe('Current');

    // Live row was actually updated.
    const { data: entryRows } = await supabase.from('collection_items').select('*').eq('id', 'entry-1').single();
    expect(entryRows?.data).toEqual({ title: 'Old' });
  });
});

describe('POST /api/cms/revisions — restore authorization (Task 6.2 fix-round-2)', () => {
  it('rejects a plain editor restoring a draft snapshot onto a currently-published post (403), row unchanged', async () => {
    const supabase = supabaseFor(USER, {
      profiles: [{ id: 'user-1', role: 'editor', client_id: 'c1' }],
      posts: [{
        id: 'post-1', client_id: 'c1', title: 'Live Published Post', slug: 'live-post',
        excerpt: null, content: '<p>live</p>', content_json: null, category: null,
        tags: [], status: 'published', cover_url: null, seo_title: null,
        seo_description: null, scheduled_at: null, published_at: '2026-01-01T00:00:00Z',
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'post', entity_id: 'post-1',
        snapshot: {
          title: 'Old Draft Title', slug: 'old-draft-title', excerpt: null,
          content: '<p>old</p>', content_json: null, category: null, tags: [],
          status: 'draft', cover_url: null, seo_title: null, seo_description: null,
          scheduled_at: null, published_at: null,
        },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'post', entity_id: 'post-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/only an admin/i);

    // The live row was never touched.
    const { data: postRow } = await supabase.from('posts').select('*').eq('id', 'post-1').single();
    expect(postRow?.status).toBe('published');
    expect(postRow?.title).toBe('Live Published Post');

    // No spurious pre-restore snapshot was inserted either — the write
    // never happened at all, so there's nothing to make undoable.
    const { data: revisionRows } = await supabase.from('revisions').select('*');
    expect(revisionRows).toHaveLength(1);
  });

  it('rejects a plain editor restoring a draft snapshot onto a currently-published page (403), row unchanged', async () => {
    const supabase = supabaseFor(USER, {
      profiles: [{ id: 'user-1', role: 'editor', client_id: 'c1' }],
      pages: [{
        id: 'page-1', client_id: 'c1', title: 'Live Page', path: '/live-page',
        content: '<p>live</p>', content_json: null, status: 'published',
        visibility: 'public', seo_title: null, seo_description: null,
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'page', entity_id: 'page-1',
        snapshot: {
          title: 'Old Page', path: '/old-page', content: '<p>old</p>',
          content_json: null, status: 'draft', visibility: 'private',
          seo_title: null, seo_description: null,
        },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'page', entity_id: 'page-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/only an admin/i);

    const { data: pageRow } = await supabase.from('pages').select('*').eq('id', 'page-1').single();
    expect(pageRow?.status).toBe('published');
    expect(pageRow?.title).toBe('Live Page');
  });

  it('rejects a plain editor restoring a draft snapshot onto a currently-published collection entry (403), row unchanged', async () => {
    const supabase = supabaseFor(USER, {
      profiles: [{ id: 'user-1', role: 'editor', client_id: 'c1' }],
      collection_items: [{
        id: 'entry-1', client_id: 'c1', collection_id: 'coll-1', slug: 'live-slug',
        status: 'published', data: { title: 'Live' }, sort_order: 0,
        published_at: '2026-01-01T00:00:00Z',
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'collection_entry', entity_id: 'entry-1',
        snapshot: { slug: 'old-slug', status: 'draft', data: { title: 'Old' }, published_at: null },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'collection_entry', entity_id: 'entry-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/only an admin/i);

    const { data: entryRow } = await supabase.from('collection_items').select('*').eq('id', 'entry-1').single();
    expect(entryRow?.status).toBe('published');
    expect(entryRow?.data).toEqual({ title: 'Live' });
  });

  it('allows a client_admin to perform the same restore that would be rejected for an editor (200, row updated)', async () => {
    const supabase = supabaseFor(USER, {
      profiles: [{ id: 'user-1', role: 'client_admin', client_id: 'c1' }],
      posts: [{
        id: 'post-1', client_id: 'c1', title: 'Live Published Post', slug: 'live-post',
        excerpt: null, content: '<p>live</p>', content_json: null, category: null,
        tags: [], status: 'published', cover_url: null, seo_title: null,
        seo_description: null, scheduled_at: null, published_at: '2026-01-01T00:00:00Z',
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'post', entity_id: 'post-1',
        snapshot: {
          title: 'Old Draft Title', slug: 'old-draft-title', excerpt: null,
          content: '<p>old</p>', content_json: null, category: null, tags: [],
          status: 'draft', cover_url: null, seo_title: null, seo_description: null,
          scheduled_at: null, published_at: null,
        },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'post', entity_id: 'post-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('draft');
    expect(body.title).toBe('Old Draft Title');

    const { data: postRow } = await supabase.from('posts').select('*').eq('id', 'post-1').single();
    expect(postRow?.status).toBe('draft');

    // The pre-restore snapshot of the (still-published) row was recorded.
    const { data: revisionRows } = await supabase.from('revisions').select('*');
    expect(revisionRows).toHaveLength(2);
  });

  it('allows a ne_admin to perform the same restore that would be rejected for an editor (200, row updated)', async () => {
    const supabase = supabaseFor(USER, {
      profiles: [{ id: 'user-1', role: 'ne_admin', client_id: null }],
      posts: [{
        id: 'post-1', client_id: 'c1', title: 'Live Published Post', slug: 'live-post',
        excerpt: null, content: '<p>live</p>', content_json: null, category: null,
        tags: [], status: 'published', cover_url: null, seo_title: null,
        seo_description: null, scheduled_at: null, published_at: '2026-01-01T00:00:00Z',
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'post', entity_id: 'post-1',
        snapshot: {
          title: 'Old Draft Title', slug: 'old-draft-title', excerpt: null,
          content: '<p>old</p>', content_json: null, category: null, tags: [],
          status: 'draft', cover_url: null, seo_title: null, seo_description: null,
          scheduled_at: null, published_at: null,
        },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'post', entity_id: 'post-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('draft');

    const { data: postRow } = await supabase.from('posts').select('*').eq('id', 'post-1').single();
    expect(postRow?.status).toBe('draft');
  });

  it('allows a plain editor to restore a revision onto a row that is currently draft (non-elevated), unaffected by the fix', async () => {
    const supabase = supabaseFor(USER, {
      profiles: [{ id: 'user-1', role: 'editor', client_id: 'c1' }],
      posts: [{
        id: 'post-1', client_id: 'c1', title: 'Current Draft', slug: 'current-draft',
        excerpt: null, content: '<p>current</p>', content_json: null, category: null,
        tags: [], status: 'draft', cover_url: null, seo_title: null,
        seo_description: null, scheduled_at: null, published_at: null,
      }],
      revisions: [{
        id: 'r1', client_id: 'c1', entity_type: 'post', entity_id: 'post-1',
        snapshot: {
          title: 'Old Draft', slug: 'old-draft', excerpt: null, content: '<p>old</p>',
          content_json: null, category: null, tags: [], status: 'draft', cover_url: null,
          seo_title: null, seo_description: null, scheduled_at: null, published_at: null,
        },
        author_id: 'user-1', created_at: '2026-01-01T00:00:00Z',
      }],
    });
    setSupabase(supabase);
    setAdmin();

    const res = await POST(postReq({ entity_type: 'post', entity_id: 'post-1', revision_id: 'r1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe('Old Draft');

    const { data: postRow } = await supabase.from('posts').select('*').eq('id', 'post-1').single();
    expect(postRow?.title).toBe('Old Draft');
    expect(postRow?.status).toBe('draft');
  });
});
