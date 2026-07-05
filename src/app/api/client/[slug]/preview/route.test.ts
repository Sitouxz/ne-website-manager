import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { GET } from './route';

function setAdmin(fixtures: Record<string, unknown[]>) {
  const admin = mockSupabase(fixtures);
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return admin;
}

function getReq(slug = 'acme', query = '', headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com/api/client/${slug}/preview${query}`, { headers });
}

const params = (slug = 'acme') => Promise.resolve({ slug });

const CLIENT = { id: 'client-1', slug: 'acme' };
const OTHER_CLIENT = { id: 'client-2', slug: 'other' };

const FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2020-01-01T00:00:00Z';

const POST_ROW = {
  id: 'post-1',
  client_id: 'client-1',
  title: 'Draft Post',
  slug: 'draft-post',
  content: '<p>hi</p>',
  excerpt: 'hi',
  cover_url: null,
  category: 'news',
  tags: [],
  status: 'draft',
  seo_title: null,
  seo_description: null,
  published_at: null,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

const PAGE_ROW = {
  id: 'page-1',
  client_id: 'client-1',
  title: 'Draft Page',
  path: '/about',
  content: '<p>about</p>',
  status: 'draft',
  visibility: 'public',
  updated_at: '2024-01-01',
};

const COLLECTION_ROW = { id: 'col-1', client_id: 'client-1', slug: 'sermons' };
const ENTRY_ROW = {
  id: 'entry-1',
  client_id: 'client-1',
  collection_id: 'col-1',
  slug: 'friday-sermon',
  status: 'draft',
  data: { title: 'Friday Sermon' },
  published_at: null,
  updated_at: '2024-01-01',
};

function fixtures(extra: Record<string, unknown[]> = {}) {
  return {
    clients: [CLIENT, OTHER_CLIENT],
    client_publish_config: [],
    preview_tokens: [],
    posts: [POST_ROW],
    pages: [PAGE_ROW],
    collections: [COLLECTION_ROW],
    collection_items: [ENTRY_ROW],
    ...extra,
  };
}

describe('GET /api/client/[slug]/preview — happy paths', () => {
  it('resolves a post token to {entityType, path, data}', async () => {
    setAdmin(fixtures({
      preview_tokens: [{ client_id: 'client-1', entity_type: 'post', entity_id: 'post-1', token: 'tok-post', expires_at: FUTURE }],
    }));

    const res = await GET(getReq('acme', '?token=tok-post'), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entityType).toBe('post');
    expect(body.path).toBe('/blog/draft-post');
    expect(body.data.id).toBe('post-1');
  });

  it('resolves a page token to {entityType, path, data}, path is pages.path verbatim', async () => {
    setAdmin(fixtures({
      preview_tokens: [{ client_id: 'client-1', entity_type: 'page', entity_id: 'page-1', token: 'tok-page', expires_at: FUTURE }],
    }));

    const res = await GET(getReq('acme', '?token=tok-page'), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entityType).toBe('page');
    expect(body.path).toBe('/about');
  });

  it('resolves a collection_entry token to {entityType, path, data}, path is /{collectionSlug}/{itemSlug}', async () => {
    setAdmin(fixtures({
      preview_tokens: [{ client_id: 'client-1', entity_type: 'collection_entry', entity_id: 'entry-1', token: 'tok-entry', expires_at: FUTURE }],
    }));

    const res = await GET(getReq('acme', '?token=tok-entry'), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.entityType).toBe('collection_entry');
    expect(body.path).toBe('/sermons/friday-sermon');
    expect(body.data.slug).toBe('friday-sermon');
  });

  it('sets Cache-Control: no-store on a successful response', async () => {
    setAdmin(fixtures({
      preview_tokens: [{ client_id: 'client-1', entity_type: 'post', entity_id: 'post-1', token: 'tok-post', expires_at: FUTURE }],
    }));

    const res = await GET(getReq('acme', '?token=tok-post'), { params: params() });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('GET /api/client/[slug]/preview — 404s', () => {
  it('404s for an unknown client slug', async () => {
    setAdmin(fixtures());
    const res = await GET(getReq('missing', '?token=anything'), { params: params('missing') });
    expect(res.status).toBe(404);
  });

  it('404s for an unknown token', async () => {
    setAdmin(fixtures());
    const res = await GET(getReq('acme', '?token=does-not-exist'), { params: params() });
    expect(res.status).toBe(404);
  });

  it('404s for an expired token', async () => {
    setAdmin(fixtures({
      preview_tokens: [{ client_id: 'client-1', entity_type: 'post', entity_id: 'post-1', token: 'tok-expired', expires_at: PAST }],
    }));
    const res = await GET(getReq('acme', '?token=tok-expired'), { params: params() });
    expect(res.status).toBe(404);
  });

  it('404s (not the other client\'s content) for a token minted for a different client', async () => {
    // Token correctly names Client A's post but was minted for Client B —
    // requesting it via Client A's own URL must still 404, since the token
    // row's client_id doesn't match.
    setAdmin(fixtures({
      preview_tokens: [{ client_id: 'client-2', entity_type: 'post', entity_id: 'post-1', token: 'cross-client', expires_at: FUTURE }],
    }));
    const res = await GET(getReq('acme', '?token=cross-client'), { params: params() });
    expect(res.status).toBe(404);
  });

  it('404s when the token names an entity that no longer exists', async () => {
    setAdmin(fixtures({
      preview_tokens: [{ client_id: 'client-1', entity_type: 'post', entity_id: 'deleted-post', token: 'tok-deleted', expires_at: FUTURE }],
    }));
    const res = await GET(getReq('acme', '?token=tok-deleted'), { params: params() });
    expect(res.status).toBe(404);
  });

  it('400s (not 404) when ?token= is missing entirely', async () => {
    setAdmin(fixtures());
    const res = await GET(getReq('acme', ''), { params: params() });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/client/[slug]/preview — x-ne-preview-secret', () => {
  it('skips the secret check when the client has no client_publish_config row', async () => {
    setAdmin(fixtures({
      preview_tokens: [{ client_id: 'client-1', entity_type: 'post', entity_id: 'post-1', token: 'tok-post', expires_at: FUTURE }],
    }));
    const res = await GET(getReq('acme', '?token=tok-post'), { params: params() });
    expect(res.status).toBe(200);
  });

  it('skips the secret check when revalidate_secret is null', async () => {
    setAdmin(fixtures({
      client_publish_config: [{ client_id: 'client-1', revalidate_secret: null }],
      preview_tokens: [{ client_id: 'client-1', entity_type: 'post', entity_id: 'post-1', token: 'tok-post', expires_at: FUTURE }],
    }));
    const res = await GET(getReq('acme', '?token=tok-post'), { params: params() });
    expect(res.status).toBe(200);
  });

  it('requires a matching x-ne-preview-secret header once revalidate_secret is configured', async () => {
    setAdmin(fixtures({
      client_publish_config: [{ client_id: 'client-1', revalidate_secret: 'shh-secret' }],
      preview_tokens: [{ client_id: 'client-1', entity_type: 'post', entity_id: 'post-1', token: 'tok-post', expires_at: FUTURE }],
    }));

    const noHeader = await GET(getReq('acme', '?token=tok-post'), { params: params() });
    expect(noHeader.status).toBe(404);

    const wrongHeader = await GET(getReq('acme', '?token=tok-post', { 'x-ne-preview-secret': 'nope' }), { params: params() });
    expect(wrongHeader.status).toBe(404);

    const rightHeader = await GET(getReq('acme', '?token=tok-post', { 'x-ne-preview-secret': 'shh-secret' }), { params: params() });
    expect(rightHeader.status).toBe(200);
  });
});
