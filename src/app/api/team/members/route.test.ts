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
import { GET, PATCH } from './route';

type Fixtures = Record<string, unknown[]>;
type MockUser = { id: string } | null;

function supabaseFor(user: MockUser, fixtures: Fixtures) {
  const base = mockSupabase(fixtures);
  return {
    ...base,
    auth: { getUser: async () => ({ data: { user } }) },
  };
}

function setSupabase(supabase: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
}

/** Service-role client stub: `mockSupabase()`-backed `.from()` plus a `getUserById` spy. */
function adminMockFor(fixtures: Fixtures, lastSignIns: Record<string, string | null> = {}) {
  const base = mockSupabase(fixtures);
  const getUserByIdSpy = vi.fn(async (id: string) => ({
    data: { user: { id, last_sign_in_at: lastSignIns[id] ?? null } },
    error: null,
  }));
  const supabase = {
    ...base,
    auth: { admin: { getUserById: getUserByIdSpy } },
  };
  return { supabase, getUserByIdSpy };
}

function setAdmin(supabase: unknown) {
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(supabase);
}

const EDITOR = { id: 'user-editor', role: 'editor', client_id: 'client-1' };
const CLIENT_ADMIN = { id: 'user-ca', role: 'client_admin', client_id: 'client-1' };
const OTHER_CLIENT_ADMIN = { id: 'user-ca2', role: 'client_admin', client_id: 'client-2' };
const NE_ADMIN = { id: 'user-ne', role: 'ne_admin', client_id: null };

const MEMBER_1 = { id: 'member-1', client_id: 'client-1', role: 'editor', full_name: 'Alice', avatar_url: null, created_at: '2026-01-01T00:00:00Z' };
const MEMBER_2 = { id: 'member-2', client_id: 'client-1', role: 'client_admin', full_name: 'Bob', avatar_url: null, created_at: '2026-01-02T00:00:00Z' };
const OTHER_CLIENT_MEMBER = { id: 'member-3', client_id: 'client-2', role: 'editor', full_name: 'Carol', avatar_url: null, created_at: '2026-01-03T00:00:00Z' };

function getReq(clientId?: string) {
  const url = clientId ? `https://example.com/api/team/members?client_id=${clientId}` : 'https://example.com/api/team/members';
  return new Request(url);
}

function patchReq(body: unknown) {
  return new Request('https://example.com/api/team/members', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('GET /api/team/members', () => {
  it('rejects an editor with 403', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR, MEMBER_1, MEMBER_2] }));
    setAdmin(adminMockFor({ profiles: [EDITOR, MEMBER_1, MEMBER_2] }).supabase);

    const res = await GET(getReq('client-1'));

    expect(res.status).toBe(403);
  });

  it('allows a client_admin to list members of their own client, including last_sign_in_at', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN, MEMBER_1, MEMBER_2] }));
    const { supabase: admin } = adminMockFor(
      { profiles: [CLIENT_ADMIN, MEMBER_1, MEMBER_2] },
      { 'member-1': '2026-02-01T00:00:00Z' }
    );
    setAdmin(admin);

    const res = await GET(getReq('client-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(3); // includes the client_admin's own row
    const alice = body.find((m: { id: string }) => m.id === 'member-1');
    expect(alice.last_sign_in_at).toBe('2026-02-01T00:00:00Z');
    const bob = body.find((m: { id: string }) => m.id === 'member-2');
    expect(bob.last_sign_in_at).toBe(null);
  });

  it("never returns another client's members to a client_admin", async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN, MEMBER_1, OTHER_CLIENT_MEMBER] }));
    const { supabase: admin } = adminMockFor({ profiles: [CLIENT_ADMIN, MEMBER_1, OTHER_CLIENT_MEMBER] });
    setAdmin(admin);

    const res = await GET(getReq('client-1'));
    const body = await res.json();

    expect(body.every((m: { client_id: string }) => m.client_id === 'client-1')).toBe(true);
  });

  it('rejects a client_admin requesting a different client_id with 403', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
    setAdmin(adminMockFor({ profiles: [CLIENT_ADMIN, OTHER_CLIENT_MEMBER] }).supabase);

    const res = await GET(getReq('client-2'));

    expect(res.status).toBe(403);
  });

  it('allows an ne_admin to list members for any client', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN] }));
    setAdmin(adminMockFor({ profiles: [NE_ADMIN, OTHER_CLIENT_MEMBER] }).supabase);

    const res = await GET(getReq('client-2'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
  });

  it('requires client_id for an ne_admin', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN] }));
    setAdmin(adminMockFor({ profiles: [NE_ADMIN] }).supabase);

    const res = await GET(getReq());

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/team/members', () => {
  it('rejects an editor with 403', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));
    setAdmin(adminMockFor({ profiles: [EDITOR, MEMBER_1] }).supabase);

    const res = await PATCH(patchReq({ id: 'member-1', role: 'client_admin' }));

    expect(res.status).toBe(403);
  });

  it('allows a client_admin to change an editor to client_admin within their own client', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
    const { supabase: admin } = adminMockFor({ profiles: [CLIENT_ADMIN, MEMBER_1] });
    setAdmin(admin);

    const res = await PATCH(patchReq({ id: 'member-1', role: 'client_admin' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const { data: rows } = await admin.from('profiles').select('*').eq('id', 'member-1');
    expect(rows![0].role).toBe('client_admin');
  });

  it(
    "rejects a client_admin trying to promote a teammate to ne_admin with 403, and does not " +
      'change their role',
    async () => {
      setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
      const { supabase: admin } = adminMockFor({ profiles: [CLIENT_ADMIN, MEMBER_1] });
      setAdmin(admin);

      const res = await PATCH(patchReq({ id: 'member-1', role: 'ne_admin' }));

      expect(res.status).toBe(403);
      const { data: rows } = await admin.from('profiles').select('*').eq('id', 'member-1');
      expect(rows![0].role).toBe('editor');
    }
  );

  it('rejects a client_admin acting on a member of a different client with 403', async () => {
    setSupabase(supabaseFor(OTHER_CLIENT_ADMIN, { profiles: [OTHER_CLIENT_ADMIN] }));
    setAdmin(adminMockFor({ profiles: [OTHER_CLIENT_ADMIN, MEMBER_1] }).supabase);

    const res = await PATCH(patchReq({ id: 'member-1', role: 'client_admin' }));

    expect(res.status).toBe(403);
  });

  it('allows a client_admin to remove (clear client_id of) a member of their own client', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
    const { supabase: admin } = adminMockFor({ profiles: [CLIENT_ADMIN, MEMBER_1] });
    setAdmin(admin);

    const res = await PATCH(patchReq({ id: 'member-1', remove: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const { data: rows } = await admin.from('profiles').select('*').eq('id', 'member-1');
    expect(rows![0].client_id).toBe(null);
    // Removal only clears client_id, never deletes the row (per the brief).
    expect(rows).toHaveLength(1);
  });

  it('allows an ne_admin to grant ne_admin and to manage any client', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN] }));
    const { supabase: admin } = adminMockFor({ profiles: [NE_ADMIN, OTHER_CLIENT_MEMBER] });
    setAdmin(admin);

    const res = await PATCH(patchReq({ id: 'member-3', role: 'ne_admin' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const { data: rows } = await admin.from('profiles').select('*').eq('id', 'member-3');
    expect(rows![0].role).toBe('ne_admin');
  });

  it('returns 404 for a nonexistent member id', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
    setAdmin(adminMockFor({ profiles: [CLIENT_ADMIN] }).supabase);

    const res = await PATCH(patchReq({ id: 'does-not-exist', role: 'editor' }));

    expect(res.status).toBe(404);
  });

  it('rejects an invalid role value with 400', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
    setAdmin(adminMockFor({ profiles: [CLIENT_ADMIN, MEMBER_1] }).supabase);

    const res = await PATCH(patchReq({ id: 'member-1', role: 'superuser' }));

    expect(res.status).toBe(400);
  });

  it('requires either role or remove', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
    setAdmin(adminMockFor({ profiles: [CLIENT_ADMIN, MEMBER_1] }).supabase);

    const res = await PATCH(patchReq({ id: 'member-1' }));

    expect(res.status).toBe(400);
  });

  // Explicit self-target privilege-escalation coverage (review Finding 3):
  // an actor targeting THEIR OWN id with role: 'ne_admin'. The guard is
  // written role-agnostically (it only checks `role === 'ne_admin' &&
  // profile?.role !== 'ne_admin'`, never comparing target id to caller
  // id), so this is already covered incidentally by the "promote a
  // teammate" test above — but self-promotion is the single most
  // important scenario here and deserves its own explicit test.
  it('rejects a client_admin attempting to self-promote to ne_admin, and does not change their own role', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));
    const { supabase: admin } = adminMockFor({ profiles: [CLIENT_ADMIN] });
    setAdmin(admin);

    const res = await PATCH(patchReq({ id: CLIENT_ADMIN.id, role: 'ne_admin' }));

    expect(res.status).toBe(403);
    const { data: rows } = await admin.from('profiles').select('*').eq('id', CLIENT_ADMIN.id);
    expect(rows![0].role).toBe('client_admin');
  });

  it('rejects an editor attempting to self-promote to ne_admin, and does not change their own role', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));
    const { supabase: admin } = adminMockFor({ profiles: [EDITOR] });
    setAdmin(admin);

    const res = await PATCH(patchReq({ id: EDITOR.id, role: 'ne_admin' }));

    expect(res.status).toBe(403);
    const { data: rows } = await admin.from('profiles').select('*').eq('id', EDITOR.id);
    expect(rows![0].role).toBe('editor');
  });
});
