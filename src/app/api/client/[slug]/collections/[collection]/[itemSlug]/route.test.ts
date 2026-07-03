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
  return new Request(`https://example.com/api/client/acme/collections/faq/one${query}`, { headers });
}

const params = (collection = 'faq', itemSlug = 'one') =>
  Promise.resolve({ slug: 'acme', collection, itemSlug });

const CLIENT = { id: 'client-1', slug: 'acme' };

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

const NATIVE_COLLECTION = { ...GENERIC_COLLECTION, id: 'col-native', slug: 'native-thing', storage: 'native', native_table: 'posts' };
const GLOBAL_COLLECTION = { ...GENERIC_COLLECTION, id: 'col-global', client_id: null, slug: 'global-thing' };

const PUBLISHED_ITEM = {
  id: 'item-pub',
  collection_id: 'col-1',
  client_id: 'client-1',
  slug: 'one',
  status: 'published',
  data: { title: 'One' },
  sort_order: 0,
  published_at: '2024-01-01',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

const DRAFT_ITEM = {
  id: 'item-draft',
  collection_id: 'col-1',
  client_id: 'client-1',
  slug: 'draft-one',
  status: 'draft',
  data: { title: 'Draft One' },
  sort_order: 1,
  published_at: null,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

function fixtures(extra: Record<string, unknown[]> = {}) {
  return {
    clients: [CLIENT],
    collections: [GENERIC_COLLECTION, NATIVE_COLLECTION, GLOBAL_COLLECTION],
    collection_items: [PUBLISHED_ITEM, DRAFT_ITEM],
    api_keys: [],
    preview_tokens: [],
    ...extra,
  };
}

describe('GET /api/client/[slug]/collections/[collection]/[itemSlug] — visibility', () => {
  it('published item is visible to anon, shaped {id, slug, data, published_at, updated_at}', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('item-pub');
    expect(Object.keys(body).sort()).toEqual(['data', 'id', 'published_at', 'slug', 'updated_at']);
  });

  it('404s a draft item for anon (no key, no preview token)', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq('', {}), { params: params('faq', 'draft-one') });

    expect(res.status).toBe(404);
  });

  it('keyed access (valid API key) sees a draft item', async () => {
    const { plaintext, prefix, keyHash } = generateApiKey();
    setAdmin(fixtures({
      api_keys: [{ client_id: 'client-1', prefix, key_hash: keyHash, revoked_at: null }],
    }));

    const res = await GET(
      getReq('', { authorization: `Bearer ${plaintext}` }),
      { params: params('faq', 'draft-one') }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('item-draft');
  });

  it('a valid, unexpired preview token unlocks a draft item', async () => {
    setAdmin(fixtures({
      preview_tokens: [{
        id: 'pt-1',
        client_id: 'client-1',
        entity_type: 'collection_entry',
        entity_id: 'item-draft',
        token: 'good-token',
        expires_at: '2099-01-01T00:00:00Z',
      }],
    }));

    const res = await GET(getReq('?preview_token=good-token'), { params: params('faq', 'draft-one') });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('item-draft');
  });

  it('an expired preview token does not unlock a draft item', async () => {
    setAdmin(fixtures({
      preview_tokens: [{
        id: 'pt-1',
        client_id: 'client-1',
        entity_type: 'collection_entry',
        entity_id: 'item-draft',
        token: 'expired-token',
        expires_at: '2020-01-01T00:00:00Z',
      }],
    }));

    const res = await GET(getReq('?preview_token=expired-token'), { params: params('faq', 'draft-one') });

    expect(res.status).toBe(404);
  });

  it('a preview token for a different entity_type does not unlock the item', async () => {
    setAdmin(fixtures({
      preview_tokens: [{
        id: 'pt-1',
        client_id: 'client-1',
        entity_type: 'post',
        entity_id: 'item-draft',
        token: 'wrong-type-token',
        expires_at: '2099-01-01T00:00:00Z',
      }],
    }));

    const res = await GET(getReq('?preview_token=wrong-type-token'), { params: params('faq', 'draft-one') });

    expect(res.status).toBe(404);
  });

  it('a preview token minted for a different item does not unlock this one', async () => {
    setAdmin(fixtures({
      preview_tokens: [{
        id: 'pt-1',
        client_id: 'client-1',
        entity_type: 'collection_entry',
        entity_id: 'some-other-item',
        token: 'wrong-item-token',
        expires_at: '2099-01-01T00:00:00Z',
      }],
    }));

    const res = await GET(getReq('?preview_token=wrong-item-token'), { params: params('faq', 'draft-one') });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/client/[slug]/collections/[collection]/[itemSlug] — 404s', () => {
  it('404s for an unknown client slug', async () => {
    setAdmin(fixtures());

    const res = await GET(
      new Request('https://example.com/api/client/missing/collections/faq/one'),
      { params: Promise.resolve({ slug: 'missing', collection: 'faq', itemSlug: 'one' }) }
    );

    expect(res.status).toBe(404);
  });

  it('404s for an unknown collection slug', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params('does-not-exist', 'one') });

    expect(res.status).toBe(404);
  });

  it('404s (not 500) for a native-storage collection', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params('native-thing', 'one') });

    expect(res.status).toBe(404);
  });

  it('404s (not 500) for a global (client_id IS NULL) collection', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params('global-thing', 'one') });

    expect(res.status).toBe(404);
  });

  it('404s for an unknown item slug within a valid collection', async () => {
    setAdmin(fixtures());

    const res = await GET(getReq(), { params: params('faq', 'does-not-exist') });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/client/[slug]/collections/[collection]/[itemSlug] — CORS', () => {
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
