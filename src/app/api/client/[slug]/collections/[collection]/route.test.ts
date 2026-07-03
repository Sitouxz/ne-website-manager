import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { generateApiKey } from '@/lib/api/auth';
import { GET } from './route';

function setAdmin(fixtures: Record<string, unknown[]>) {
  const admin = mockSupabase(fixtures);
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return admin;
}

function getReq(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com/api/client/acme/collections/faq${query}`, { headers });
}

const params = (collection = 'faq') => Promise.resolve({ slug: 'acme', collection });

const CLIENT = { id: 'client-1', slug: 'acme' };
const OTHER_CLIENT = { id: 'client-2', slug: 'other' };

const GENERIC_COLLECTION = {
  id: 'col-1',
  client_id: 'client-1',
  slug: 'faq',
  name: 'FAQs',
  name_singular: 'FAQ',
  icon: null,
  description: null,
  storage: 'generic',
  native_table: null,
  fields: [],
  options: {},
  is_system: false,
  sort_order: 0,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

const NATIVE_COLLECTION = {
  ...GENERIC_COLLECTION,
  id: 'col-native',
  slug: 'native-thing',
  storage: 'native',
  native_table: 'posts',
};

const GLOBAL_COLLECTION = {
  ...GENERIC_COLLECTION,
  id: 'col-global',
  client_id: null,
  slug: 'global-thing',
};

function item(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `item-${Math.random()}`,
    collection_id: 'col-1',
    client_id: 'client-1',
    slug: 'item',
    status: 'published',
    data: { title: 'Item' },
    sort_order: 0,
    published_at: '2024-01-01',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

const PUBLISHED_ITEMS = [
  item({ id: 'i1', slug: 'one', sort_order: 2, published_at: '2024-01-01', data: { title: 'One' } }),
  item({ id: 'i2', slug: 'two', sort_order: 0, published_at: '2024-03-01', data: { title: 'Two' } }),
  item({ id: 'i3', slug: 'three', sort_order: 1, published_at: '2024-02-01', data: { title: 'Three' } }),
];

const DRAFT_ITEM = item({ id: 'draft-1', slug: 'draft-item', status: 'draft', sort_order: -1, published_at: null, data: { title: 'Draft' } });
const ARCHIVED_ITEM = item({ id: 'archived-1', slug: 'archived-item', status: 'archived', sort_order: 99, published_at: '2020-01-01', data: { title: 'Archived' } });

const OTHER_CLIENT_ITEM = item({ id: 'other-1', collection_id: 'col-other', client_id: 'client-2', slug: 'other-item' });

function fixtures(extra: Record<string, unknown[]> = {}) {
  return {
    clients: [CLIENT, OTHER_CLIENT],
    collections: [GENERIC_COLLECTION, NATIVE_COLLECTION, GLOBAL_COLLECTION],
    collection_items: [...PUBLISHED_ITEMS, DRAFT_ITEM, ARCHIVED_ITEM, OTHER_CLIENT_ITEM],
    api_keys: [],
    ...extra,
  };
}

describe('GET /api/client/[slug]/collections/[collection] — visibility', () => {
  it('anon (public) sees only published items, shaped {id, slug, data, published_at, updated_at}', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(3);
    expect(body.some((i: { id: string }) => i.id === 'draft-1')).toBe(false);
    expect(body.some((i: { id: string }) => i.id === 'archived-1')).toBe(false);
    expect(body.some((i: { id: string }) => i.id === 'other-1')).toBe(false);

    for (const row of body) {
      expect(Object.keys(row).sort()).toEqual(['data', 'id', 'published_at', 'slug', 'updated_at']);
    }
  });

  it('keyed access (valid API key) sees drafts and archived items too', async () => {
    const { plaintext, prefix, keyHash } = generateApiKey();
    setAdmin(fixtures({
      api_keys: [{ client_id: 'client-1', prefix, key_hash: keyHash, revoked_at: null }],
    }));

    const res = await GET(getReq('', { authorization: `Bearer ${plaintext}` }), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(5);
    expect(body.some((i: { id: string }) => i.id === 'draft-1')).toBe(true);
    expect(body.some((i: { id: string }) => i.id === 'archived-1')).toBe(true);
    expect(body.some((i: { id: string }) => i.id === 'other-1')).toBe(false);
  });
});

describe('GET /api/client/[slug]/collections/[collection] — sorting & pagination', () => {
  it('defaults to sort_order ascending', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params() });
    const body = await res.json();

    expect(body.map((i: { slug: string }) => i.slug)).toEqual(['two', 'three', 'one']);
  });

  it('?sort=published_at orders newest first', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq('?sort=published_at'), { params: params() });
    const body = await res.json();

    expect(body.map((i: { slug: string }) => i.slug)).toEqual(['two', 'three', 'one']);
  });

  it('applies limit/offset and reports X-Total-Count', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq('?limit=2&offset=0'), { params: params() });
    const body = await res.json();

    expect(body).toHaveLength(2);
    expect(res.headers.get('X-Total-Count')).toBe('3');
  });
});

describe('GET /api/client/[slug]/collections/[collection] — 404s', () => {
  it('404s for an unknown client slug', async () => {
    setAdmin(fixtures());

    const res = await GET(
      new Request('https://example.com/api/client/missing/collections/faq'),
      { params: Promise.resolve({ slug: 'missing', collection: 'faq' }) }
    );

    expect(res.status).toBe(404);
  });

  it('404s for an unknown collection slug', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params('does-not-exist') });

    expect(res.status).toBe(404);
  });

  it('404s (not 500, not empty-200) for a native-storage collection', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params('native-thing') });

    expect(res.status).toBe(404);
  });

  it('404s (not 500, not empty-200) for a global (client_id IS NULL) collection', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params('global-thing') });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/client/[slug]/collections/[collection] — CORS', () => {
  it('sets Access-Control-Allow-Origin on the response', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params() });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('OPTIONS returns 204 with CORS headers', async () => {
    const { OPTIONS } = await import('./route');
    const res = await OPTIONS();

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
