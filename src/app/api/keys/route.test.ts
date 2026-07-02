import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { GET, POST, DELETE } from './route';

type Fixtures = Record<string, unknown[]>;
type MockUser = { id: string } | null;

/** Builds a `mockSupabase()` instance augmented with a minimal `auth.getUser()`. */
function supabaseFor(user: MockUser, fixtures: Fixtures) {
  const base = mockSupabase(fixtures);
  return {
    ...base,
    auth: {
      getUser: async () => ({ data: { user } }),
    },
  };
}

/**
 * Same as `supabaseFor`, but also returns a spy capturing every payload
 * passed to `.from('api_keys').insert(...)`, so tests can assert on the
 * exact shape written to the DB without relying on `.select()` column
 * projection (the in-memory mock doesn't actually filter columns).
 */
function supabaseWithInsertSpy(user: MockUser, fixtures: Fixtures) {
  const base = mockSupabase(fixtures);
  const insertSpy = vi.fn();
  const supabase = {
    ...base,
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from(table: string) {
      const qb = base.from(table);
      if (table === 'api_keys') {
        const originalInsert = qb.insert.bind(qb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (qb as any).insert = (payload: unknown) => {
          insertSpy(payload);
          return originalInsert(payload as never);
        };
      }
      return qb;
    },
  };
  return { supabase, insertSpy };
}

function setSupabase(supabase: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
}

const EDITOR = { id: 'user-editor', role: 'editor', client_id: 'client-1' };
const CLIENT_ADMIN = { id: 'user-ca', role: 'client_admin', client_id: 'client-1' };
const NE_ADMIN = { id: 'user-ne', role: 'ne_admin', client_id: null };

const EXISTING_KEY = {
  id: 'key-1',
  client_id: 'client-1',
  name: 'Existing key',
  prefix: 'aaaaaaaa',
  key_hash: 'deadbeef',
  scopes: null,
  created_at: '2026-01-01T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
};

const OTHER_CLIENT_KEY = {
  id: 'key-2',
  client_id: 'client-2',
  name: 'Other client key',
  prefix: 'bbbbbbbb',
  key_hash: 'cafebabe',
  scopes: null,
  created_at: '2026-01-01T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
};

function getReq(clientId?: string) {
  const url = clientId
    ? `https://example.com/api/keys?client_id=${clientId}`
    : 'https://example.com/api/keys';
  return new Request(url);
}

function postReq(body: unknown) {
  return new Request('https://example.com/api/keys', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function deleteReq(id?: string) {
  const url = id ? `https://example.com/api/keys?id=${id}` : 'https://example.com/api/keys';
  return new Request(url, { method: 'DELETE' });
}

describe('GET /api/keys', () => {
  it('rejects an editor with 403', async () => {
    setSupabase(
      supabaseFor(EDITOR, {
        profiles: [EDITOR],
        api_keys: [EXISTING_KEY],
      })
    );

    const res = await GET(getReq('client-1'));

    expect(res.status).toBe(403);
  });

  it('rejects a client_admin targeting a different client_id with 403', async () => {
    setSupabase(
      supabaseFor(CLIENT_ADMIN, {
        profiles: [CLIENT_ADMIN],
        api_keys: [OTHER_CLIENT_KEY],
      })
    );

    const res = await GET(getReq('client-2'));

    expect(res.status).toBe(403);
  });

  it('allows a client_admin to list keys for their own client_id', async () => {
    setSupabase(
      supabaseFor(CLIENT_ADMIN, {
        profiles: [CLIENT_ADMIN],
        api_keys: [EXISTING_KEY],
      })
    );

    const res = await GET(getReq('client-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('key-1');
  });

  it('allows an ne_admin to list keys for any client', async () => {
    setSupabase(
      supabaseFor(NE_ADMIN, {
        profiles: [NE_ADMIN],
        api_keys: [OTHER_CLIENT_KEY],
      })
    );

    const res = await GET(getReq('client-2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('key-2');
  });

  it('rejects an unauthenticated caller (no profile resolvable) from managing keys', async () => {
    setSupabase(supabaseFor(null, { profiles: [], api_keys: [EXISTING_KEY] }));

    const res = await GET(getReq('client-1'));

    // No authenticated user means no profile is ever loaded, so `canManage`
    // fails closed. The route doesn't special-case "no user" before the
    // canManage check on GET, so this denies access via 403 rather than a
    // dedicated 401 — access is still correctly refused either way.
    expect(res.status).toBe(403);
  });
});

describe('POST /api/keys', () => {
  it('rejects an editor with 403', async () => {
    setSupabase(
      supabaseFor(EDITOR, {
        profiles: [EDITOR],
        api_keys: [],
      })
    );

    const res = await POST(postReq({ client_id: 'client-1', name: 'New key' }));

    expect(res.status).toBe(403);
  });

  it('rejects a client_admin targeting a different client_id with 403', async () => {
    setSupabase(
      supabaseFor(CLIENT_ADMIN, {
        profiles: [CLIENT_ADMIN],
        api_keys: [],
      })
    );

    const res = await POST(postReq({ client_id: 'client-2', name: 'New key' }));

    expect(res.status).toBe(403);
  });

  it('allows a client_admin to generate a key for their own client_id', async () => {
    const { supabase } = supabaseWithInsertSpy(CLIENT_ADMIN, {
      profiles: [CLIENT_ADMIN],
      api_keys: [],
    });
    setSupabase(supabase);

    const res = await POST(postReq({ client_id: 'client-1', name: 'New key' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(typeof body.plaintext).toBe('string');
    expect(body.plaintext).toMatch(/^ne_[a-f0-9]+_[a-f0-9]+$/);
  });

  it('allows an ne_admin to generate a key for any client', async () => {
    const { supabase } = supabaseWithInsertSpy(NE_ADMIN, {
      profiles: [NE_ADMIN],
      api_keys: [],
    });
    setSupabase(supabase);

    const res = await POST(postReq({ client_id: 'client-2', name: 'New key' }));

    expect(res.status).toBe(200);
  });

  it('returns 401 when unauthenticated', async () => {
    setSupabase(supabaseFor(null, { profiles: [], api_keys: [] }));

    const res = await POST(postReq({ client_id: 'client-1', name: 'New key' }));

    expect(res.status).toBe(401);
  });

  it('returns the plaintext key exactly once, and never persists it or a raw key string to the DB', async () => {
    const { supabase, insertSpy } = supabaseWithInsertSpy(CLIENT_ADMIN, {
      profiles: [CLIENT_ADMIN],
      api_keys: [],
    });
    setSupabase(supabase);

    const res = await POST(postReq({ client_id: 'client-1', name: 'New key' }));
    const body = await res.json();

    // Plaintext appears exactly once in the response body.
    const bodyJson = JSON.stringify(body);
    expect(bodyJson.match(new RegExp(body.plaintext, 'g'))).toHaveLength(1);

    // The row actually written to the DB never carries a plaintext field
    // or the raw key string — only the non-secret prefix and the hash.
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const insertedRow = insertSpy.mock.calls[0][0] as Record<string, unknown>;

    expect(insertedRow).not.toHaveProperty('plaintext');
    expect(insertedRow).toHaveProperty('prefix');
    expect(insertedRow).toHaveProperty('key_hash');
    expect(JSON.stringify(insertedRow)).not.toContain(body.plaintext);
    expect(insertedRow.key_hash).not.toBe(body.plaintext);
  });
});

describe('DELETE /api/keys', () => {
  it('rejects an editor with 403', async () => {
    setSupabase(
      supabaseFor(EDITOR, {
        profiles: [EDITOR],
        api_keys: [EXISTING_KEY],
      })
    );

    const res = await DELETE(deleteReq('key-1'));

    expect(res.status).toBe(403);
  });

  it('rejects a client_admin targeting a key belonging to a different client_id with 403', async () => {
    setSupabase(
      supabaseFor(CLIENT_ADMIN, {
        profiles: [CLIENT_ADMIN],
        api_keys: [OTHER_CLIENT_KEY],
      })
    );

    const res = await DELETE(deleteReq('key-2'));

    expect(res.status).toBe(403);
  });

  it('allows a client_admin to revoke a key for their own client_id', async () => {
    setSupabase(
      supabaseFor(CLIENT_ADMIN, {
        profiles: [CLIENT_ADMIN],
        api_keys: [EXISTING_KEY],
      })
    );

    const res = await DELETE(deleteReq('key-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('allows an ne_admin to revoke a key for any client', async () => {
    setSupabase(
      supabaseFor(NE_ADMIN, {
        profiles: [NE_ADMIN],
        api_keys: [OTHER_CLIENT_KEY],
      })
    );

    const res = await DELETE(deleteReq('key-2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('rejects an unauthenticated caller (no profile resolvable) from revoking keys', async () => {
    setSupabase(supabaseFor(null, { profiles: [], api_keys: [EXISTING_KEY] }));

    const res = await DELETE(deleteReq('key-1'));

    // Same fail-closed shape as GET: no user -> no profile -> canManage
    // denies -> 403, rather than a dedicated 401. Access is still refused.
    expect(res.status).toBe(403);
  });
});
