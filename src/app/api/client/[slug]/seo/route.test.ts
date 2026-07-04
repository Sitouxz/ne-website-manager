import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { GET, OPTIONS } from './route';

function setAdmin(fixtures: Record<string, unknown[]>) {
  const admin = mockSupabase(fixtures);
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return admin;
}

function getReq(): Request {
  return new Request('https://example.com/api/client/acme/seo');
}

const params = Promise.resolve({ slug: 'acme' });

const CLIENT = { id: 'client-1', slug: 'acme' };
const OTHER_CLIENT = { id: 'client-2', slug: 'other' };

// ---- redirects ----
const REDIRECT_1 = {
  id: 'r1', client_id: 'client-1', from_path: '/old-about', to_path: '/about', permanent: true,
  created_at: '2024-01-01', updated_at: '2024-01-01',
};
const REDIRECT_2 = {
  id: 'r2', client_id: 'client-1', from_path: '/temp-promo', to_path: '/promo', permanent: false,
  created_at: '2024-01-01', updated_at: '2024-01-01',
};
const OTHER_CLIENT_REDIRECT = {
  id: 'r-other', client_id: 'client-2', from_path: '/x', to_path: '/y', permanent: true,
  created_at: '2024-01-01', updated_at: '2024-01-01',
};

// ---- pages ----
const PUBLISHED_PUBLIC_PAGE = {
  id: 'p1', client_id: 'client-1', title: 'About', path: '/about', content: '', status: 'published',
  visibility: 'public', content_json: null, seo_title: null, seo_description: null, updated_at: '2024-02-01',
};
const DRAFT_PAGE = {
  id: 'p2', client_id: 'client-1', title: 'Draft', path: '/draft-page', content: '', status: 'draft',
  visibility: 'public', content_json: null, seo_title: null, seo_description: null, updated_at: '2024-02-01',
};
const PRIVATE_PUBLISHED_PAGE = {
  id: 'p3', client_id: 'client-1', title: 'Private', path: '/private-page', content: '', status: 'published',
  visibility: 'private', content_json: null, seo_title: null, seo_description: null, updated_at: '2024-02-01',
};
const OTHER_CLIENT_PAGE = {
  id: 'p4', client_id: 'client-2', title: 'Other', path: '/other-page', content: '', status: 'published',
  visibility: 'public', content_json: null, seo_title: null, seo_description: null, updated_at: '2024-02-01',
};

// ---- posts ----
const PUBLISHED_POST = {
  id: 'post-1', client_id: 'client-1', title: 'Hello World', slug: 'hello-world', content: '', excerpt: '',
  cover_url: null, category: '', tags: [], status: 'published', seo_title: null, seo_description: null,
  content_json: null, scheduled_at: null, author_id: null, published_at: '2024-01-05', updated_at: '2024-03-01',
};
const ARCHIVED_POST = {
  id: 'post-2', client_id: 'client-1', title: 'Old', slug: 'old-post', content: '', excerpt: '',
  cover_url: null, category: '', tags: [], status: 'archived', seo_title: null, seo_description: null,
  content_json: null, scheduled_at: null, author_id: null, published_at: null, updated_at: '2024-03-01',
};
const OTHER_CLIENT_POST = {
  id: 'post-3', client_id: 'client-2', title: 'Other', slug: 'other-post', content: '', excerpt: '',
  cover_url: null, category: '', tags: [], status: 'published', seo_title: null, seo_description: null,
  content_json: null, scheduled_at: null, author_id: null, published_at: '2024-01-05', updated_at: '2024-03-01',
};

// ---- collections ----
const GENERIC_COLLECTION = {
  id: 'col-1', client_id: 'client-1', slug: 'sermons', name: 'Sermons', name_singular: 'Sermon',
  icon: null, description: null, storage: 'generic', native_table: null, fields: [], options: {},
  is_system: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01',
};
const NATIVE_COLLECTION = {
  ...GENERIC_COLLECTION, id: 'col-native', slug: 'native-thing', storage: 'native', native_table: 'posts',
};
const GLOBAL_COLLECTION = {
  ...GENERIC_COLLECTION, id: 'col-global', client_id: null, slug: 'global-thing',
};
const OTHER_CLIENT_COLLECTION = {
  ...GENERIC_COLLECTION, id: 'col-other', client_id: 'client-2', slug: 'other-coll',
};

// ---- collection_items ----
const PUBLISHED_ITEM = {
  id: 'item-1', collection_id: 'col-1', client_id: 'client-1', slug: 'friday-sermon', status: 'published',
  data: { title: 'Friday Sermon' }, sort_order: 0, published_at: '2024-01-10', created_at: '2024-01-01',
  updated_at: '2024-04-01',
};
const DRAFT_ITEM = {
  id: 'item-2', collection_id: 'col-1', client_id: 'client-1', slug: 'unpublished-sermon', status: 'draft',
  data: { title: 'Unpublished' }, sort_order: 1, published_at: null, created_at: '2024-01-01', updated_at: '2024-04-01',
};
const ARCHIVED_ITEM = {
  id: 'item-3', collection_id: 'col-1', client_id: 'client-1', slug: 'archived-sermon', status: 'archived',
  data: { title: 'Archived' }, sort_order: 2, published_at: null, created_at: '2024-01-01', updated_at: '2024-04-01',
};
// Published item belonging to a native collection — must NOT appear (would
// duplicate the post/page already represented directly).
const PUBLISHED_ITEM_IN_NATIVE_COLLECTION = {
  id: 'item-native', collection_id: 'col-native', client_id: 'client-1', slug: 'native-entry', status: 'published',
  data: {}, sort_order: 0, published_at: '2024-01-10', created_at: '2024-01-01', updated_at: '2024-04-01',
};

function fixtures() {
  return {
    clients: [CLIENT, OTHER_CLIENT],
    redirects: [REDIRECT_1, REDIRECT_2, OTHER_CLIENT_REDIRECT],
    pages: [PUBLISHED_PUBLIC_PAGE, DRAFT_PAGE, PRIVATE_PUBLISHED_PAGE, OTHER_CLIENT_PAGE],
    posts: [PUBLISHED_POST, ARCHIVED_POST, OTHER_CLIENT_POST],
    collections: [GENERIC_COLLECTION, NATIVE_COLLECTION, GLOBAL_COLLECTION, OTHER_CLIENT_COLLECTION],
    collection_items: [PUBLISHED_ITEM, DRAFT_ITEM, ARCHIVED_ITEM, PUBLISHED_ITEM_IN_NATIVE_COLLECTION],
  };
}

describe('GET /api/client/[slug]/seo — misc', () => {
  it('returns 404 when the client slug does not exist', async () => {
    setAdmin({ clients: [] });

    const res = await GET(getReq(), { params });

    expect(res.status).toBe(404);
  });

  it('sets CORS header on the response', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('OPTIONS responds 204 with CORS headers', async () => {
    const res = await OPTIONS();

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

describe('GET /api/client/[slug]/seo — redirects', () => {
  it('returns redirects shaped as {from_path, to_path, permanent}, scoped to the resolved client', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.redirects).toEqual(expect.arrayContaining([
      { from_path: '/old-about', to_path: '/about', permanent: true },
      { from_path: '/temp-promo', to_path: '/promo', permanent: false },
    ]));
    expect(body.redirects).toHaveLength(2);
    expect(body.redirects.some((r: { from_path: string }) => r.from_path === '/x')).toBe(false);
  });

  it('returns an empty redirects array when the client has none', async () => {
    setAdmin({ clients: [CLIENT], redirects: [], pages: [], posts: [], collections: [], collection_items: [] });

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.redirects).toEqual([]);
  });
});

describe('GET /api/client/[slug]/seo — sitemap', () => {
  it('includes a published page using pages.path verbatim', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.sitemap).toEqual(expect.arrayContaining([
      { path: '/about', updated_at: '2024-02-01' },
    ]));
  });

  it('includes a published post under the /blog/{slug} prefix', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.sitemap).toEqual(expect.arrayContaining([
      { path: '/blog/hello-world', updated_at: '2024-03-01' },
    ]));
  });

  it('includes a published generic-collection entry under /{collection.slug}/{item.slug}', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.sitemap).toEqual(expect.arrayContaining([
      { path: '/sermons/friday-sermon', updated_at: '2024-04-01' },
    ]));
  });

  it('excludes draft pages, archived posts, and draft/archived collection entries', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });
    const body = await res.json();

    const paths = body.sitemap.map((e: { path: string }) => e.path);
    expect(paths).not.toContain('/draft-page');
    expect(paths).not.toContain('/blog/old-post');
    expect(paths).not.toContain('/sermons/unpublished-sermon');
    expect(paths).not.toContain('/sermons/archived-sermon');
  });

  it('excludes a published page marked visibility=private, even though status=published', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });
    const body = await res.json();

    const paths = body.sitemap.map((e: { path: string }) => e.path);
    expect(paths).not.toContain('/private-page');
  });

  it('excludes published entries belonging to a native-storage collection', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });
    const body = await res.json();

    const paths = body.sitemap.map((e: { path: string }) => e.path);
    expect(paths).not.toContain('/native-thing/native-entry');
  });

  it('excludes global/system collections (client_id IS NULL) entirely', async () => {
    setAdmin({
      clients: [CLIENT],
      redirects: [],
      pages: [],
      posts: [],
      collections: [GLOBAL_COLLECTION],
      collection_items: [
        { id: 'gi1', collection_id: 'col-global', client_id: 'client-1', slug: 'global-entry', status: 'published', data: {}, sort_order: 0, published_at: '2024-01-01', created_at: '2024-01-01', updated_at: '2024-01-01' },
      ],
    });

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.sitemap).toEqual([]);
  });

  it('never includes another client\'s pages, posts, or collection content', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params });
    const body = await res.json();

    const paths = body.sitemap.map((e: { path: string }) => e.path);
    expect(paths).not.toContain('/other-page');
    expect(paths).not.toContain('/blog/other-post');
    expect(paths).not.toContain('/other-coll/');
  });

  it('returns an empty sitemap array when the client has no published content', async () => {
    setAdmin({ clients: [CLIENT], redirects: [], pages: [], posts: [], collections: [], collection_items: [] });

    const res = await GET(getReq(), { params });
    const body = await res.json();

    expect(body.sitemap).toEqual([]);
  });
});
