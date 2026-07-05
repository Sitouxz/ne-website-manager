import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

// Deliberately mock only `@/lib/supabase/admin` and `@/lib/supabase/server`
// (never a shared client) — this route's whole reason for existing is that
// a freshly-invited user can't read their own invitation row through the
// user-scoped client's RLS, so it must resolve identity via the
// user-scoped client and everything else via the service-role client.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { POST } from './route';

type Fixtures = Record<string, unknown[]>;
type MockUser = { id: string; email?: string } | null;

function supabaseFor(user: MockUser) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
  };
}

function setSupabase(supabase: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
}

function setAdmin(fixtures: Fixtures) {
  const admin = mockSupabase(fixtures);
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return admin;
}

const NOW = Date.now();
const FUTURE = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(NOW - 60 * 1000).toISOString();

const CALLER = { id: 'user-invited', email: 'invitee@acme.com' };

const VALID_INVITATION = {
  id: 'inv-1',
  client_id: 'client-1',
  email: 'invitee@acme.com',
  role: 'editor',
  invited_by: 'user-ca',
  token: 'tok-valid',
  expires_at: FUTURE,
  accepted_at: null,
};

const CALLER_PROFILE = { id: 'user-invited', role: 'editor', client_id: null };

function postReq(body: unknown) {
  return new Request('https://example.com/api/team/accept-invite', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/team/accept-invite', () => {
  it('rejects an unauthenticated caller with 401', async () => {
    setSupabase(supabaseFor(null));
    setAdmin({ invitations: [VALID_INVITATION], profiles: [CALLER_PROFILE] });

    const res = await POST(postReq({ token: 'tok-valid' }));

    expect(res.status).toBe(401);
  });

  it('requires a token', async () => {
    setSupabase(supabaseFor(CALLER));
    setAdmin({ invitations: [VALID_INVITATION], profiles: [CALLER_PROFILE] });

    const res = await POST(postReq({}));

    expect(res.status).toBe(400);
  });

  it('returns 404 when the token does not match any invitation', async () => {
    setSupabase(supabaseFor(CALLER));
    setAdmin({ invitations: [VALID_INVITATION], profiles: [CALLER_PROFILE] });

    const res = await POST(postReq({ token: 'tok-does-not-exist' }));

    expect(res.status).toBe(404);
  });

  it('returns 400 when the invitation was already accepted', async () => {
    setSupabase(supabaseFor(CALLER));
    setAdmin({
      invitations: [{ ...VALID_INVITATION, accepted_at: '2026-01-01T00:00:00Z' }],
      profiles: [CALLER_PROFILE],
    });

    const res = await POST(postReq({ token: 'tok-valid' }));

    expect(res.status).toBe(400);
  });

  it('returns 410 when the invitation has expired', async () => {
    setSupabase(supabaseFor(CALLER));
    setAdmin({
      invitations: [{ ...VALID_INVITATION, expires_at: PAST }],
      profiles: [CALLER_PROFILE],
    });

    const res = await POST(postReq({ token: 'tok-valid' }));

    expect(res.status).toBe(410);
  });

  it(
    'returns 403 and does NOT apply client_id/role when the invitation email does not match the ' +
      "authenticated caller's email (privilege-escalation guard: accepting someone else's invite " +
      'token while signed in as a different user must not work)',
    async () => {
      const mismatchedCaller = { id: 'user-attacker', email: 'attacker@evil.com' };
      setSupabase(supabaseFor(mismatchedCaller));
      const admin = setAdmin({
        invitations: [VALID_INVITATION],
        profiles: [{ id: 'user-attacker', role: 'editor', client_id: null }],
      });

      const res = await POST(postReq({ token: 'tok-valid' }));

      expect(res.status).toBe(403);

      const { data: profileRows } = await admin.from('profiles').select('*').eq('id', 'user-attacker');
      expect(profileRows![0].client_id).toBe(null);
      expect(profileRows![0].role).toBe('editor');

      const { data: invitationRows } = await admin.from('invitations').select('*').eq('id', 'inv-1');
      expect(invitationRows![0].accepted_at).toBe(null);
    }
  );

  it('is case-insensitive when comparing the invitation email to the caller email', async () => {
    const caller = { id: 'user-invited', email: 'Invitee@Acme.com' };
    setSupabase(supabaseFor(caller));
    setAdmin({ invitations: [VALID_INVITATION], profiles: [CALLER_PROFILE] });

    const res = await POST(postReq({ token: 'tok-valid' }));

    expect(res.status).toBe(200);
  });

  it(
    "applies the invitation's client_id/role to the caller's own profile and marks the invitation " +
      'accepted, on a matching email',
    async () => {
      setSupabase(supabaseFor(CALLER));
      const admin = setAdmin({ invitations: [VALID_INVITATION], profiles: [CALLER_PROFILE] });

      const res = await POST(postReq({ token: 'tok-valid' }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);

      const { data: profileRows } = await admin.from('profiles').select('*').eq('id', 'user-invited');
      expect(profileRows![0].client_id).toBe('client-1');
      expect(profileRows![0].role).toBe('editor');

      const { data: invitationRows } = await admin.from('invitations').select('*').eq('id', 'inv-1');
      expect(invitationRows![0].accepted_at).not.toBe(null);
    }
  );
});
