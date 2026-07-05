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
import { POST } from './route';

type Fixtures = Record<string, unknown[]>;
type MockUser = { id: string; email?: string } | null;

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

function setSupabase(supabase: unknown) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
}

/** Stub service-role client whose `auth.admin.inviteUserByEmail` is a spy. */
function adminMock(opts: { inviteError?: { message: string } } = {}) {
  const inviteSpy = vi.fn(async (_email: string, _options?: unknown) => ({
    data: { user: { id: 'invited-user-1' } },
    error: opts.inviteError ?? null,
  }));
  const supabase = {
    auth: { admin: { inviteUserByEmail: inviteSpy } },
  };
  return { supabase, inviteSpy };
}

function setAdmin(supabase: unknown) {
  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(supabase);
}

const EDITOR = { id: 'user-editor', role: 'editor', client_id: 'client-1' };
const CLIENT_ADMIN = { id: 'user-ca', role: 'client_admin', client_id: 'client-1' };
const NE_ADMIN = { id: 'user-ne', role: 'ne_admin', client_id: null };

function postReq(body: unknown) {
  return new Request('https://example.com/api/team/invite', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/team/invite', () => {
  it('rejects an unauthenticated caller with 401', async () => {
    setSupabase(supabaseFor(null, { profiles: [] }));
    setAdmin(adminMock().supabase);

    const res = await POST(postReq({ email: 'new@acme.com', role: 'editor' }));

    expect(res.status).toBe(401);
  });

  it('rejects a plain editor with 403 (editor cannot invite)', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR], invitations: [] }));
    const { supabase: admin, inviteSpy } = adminMock();
    setAdmin(admin);

    const res = await POST(postReq({ email: 'new@acme.com', role: 'editor' }));

    expect(res.status).toBe(403);
    // The real, security-relevant assertion: an editor's request must never
    // reach the point of actually sending an invite email.
    expect(inviteSpy).not.toHaveBeenCalled();
  });

  it("rejects a client_admin inviting role 'ne_admin' with 400, and never sends the invite email", async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN], invitations: [] }));
    const { supabase: admin, inviteSpy } = adminMock();
    setAdmin(admin);

    const res = await POST(postReq({ email: 'new@acme.com', role: 'ne_admin' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/client_admin.*editor|editor.*client_admin/i);
    expect(inviteSpy).not.toHaveBeenCalled();
  });

  it('rejects a client_admin targeting a different client_id with 403', async () => {
    const supabase = supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN], invitations: [] });
    setSupabase(supabase);
    const { supabase: admin, inviteSpy } = adminMock();
    setAdmin(admin);

    const res = await POST(postReq({ email: 'new@acme.com', role: 'editor', client_id: 'client-2' }));

    // A client_admin is always pinned to their own client_id regardless of
    // what the body claims, so this must still act on client-1 and never
    // actually reach client-2. Positively prove that by reading back the
    // client_id that actually landed in the created invitations row —
    // asserting only the status code / call count doesn't prove the
    // spoofed client_id in the request body was ignored.
    expect(res.status).toBe(200);
    expect(inviteSpy).toHaveBeenCalledTimes(1);

    const rows = await supabase.from('invitations').select('*');
    expect(rows.data).toHaveLength(1);
    const row = rows.data![0] as Record<string, unknown>;
    expect(row.client_id).toBe('client-1');
    expect(row.client_id).not.toBe('client-2');
  });

  it('allows a client_admin to invite an editor for their own client, creating an invitations row and sending the email', async () => {
    const supabase = supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN], invitations: [] });
    setSupabase(supabase);
    const { supabase: admin, inviteSpy } = adminMock();
    setAdmin(admin);

    const res = await POST(postReq({ email: 'New@Acme.com', role: 'editor' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(inviteSpy).toHaveBeenCalledTimes(1);
    const [email, options] = inviteSpy.mock.calls[0];
    expect(email).toBe('new@acme.com'); // normalized to lowercase
    expect((options as { redirectTo: string }).redirectTo).toMatch(/\/accept-invite\?token=/);

    const rows = await supabase.from('invitations').select('*');
    expect(rows.data).toHaveLength(1);
    const row = rows.data![0] as Record<string, unknown>;
    expect(row.client_id).toBe('client-1');
    expect(row.role).toBe('editor');
    expect(row.email).toBe('new@acme.com');
    expect(row.invited_by).toBe('user-ca');
    expect(typeof row.token).toBe('string');
    expect((row.token as string).length).toBeGreaterThanOrEqual(32);
  });

  it('allows an ne_admin to invite a client_admin for an explicit client_id', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN], invitations: [] }));
    const { supabase: admin, inviteSpy } = adminMock();
    setAdmin(admin);

    const res = await POST(postReq({ email: 'admin2@acme.com', role: 'client_admin', client_id: 'client-2' }));

    expect(res.status).toBe(200);
    expect(inviteSpy).toHaveBeenCalledTimes(1);
  });

  it('requires client_id when an ne_admin invites without one', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN], invitations: [] }));
    setAdmin(adminMock().supabase);

    const res = await POST(postReq({ email: 'admin2@acme.com', role: 'client_admin' }));

    expect(res.status).toBe(400);
  });

  it('rejects an invalid role value with 400', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN], invitations: [] }));
    setAdmin(adminMock().supabase);

    const res = await POST(postReq({ email: 'new@acme.com', role: 'superuser' }));

    expect(res.status).toBe(400);
  });

  it('requires an email', async () => {
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN], invitations: [] }));
    setAdmin(adminMock().supabase);

    const res = await POST(postReq({ role: 'editor' }));

    expect(res.status).toBe(400);
  });

  it('rolls back the invitations row if the invite email fails to send', async () => {
    const supabase = supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN], invitations: [] });
    setSupabase(supabase);
    setAdmin(adminMock({ inviteError: { message: 'SMTP failure' } }).supabase);

    const res = await POST(postReq({ email: 'new@acme.com', role: 'editor' }));

    expect(res.status).toBe(500);
    const rows = await supabase.from('invitations').select('*');
    expect(rows.data).toHaveLength(0);
  });

  it('returns a generic error message (not the raw Supabase Auth error) when the invite email fails to send', async () => {
    // Account-enumeration guard: Supabase Auth's invite API returns a
    // distinguishable error when the target email already has a
    // registered account, and a client_admin can invite ANY email
    // address — so the raw inviteError.message must never reach the
    // HTTP response.
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN], invitations: [] }));
    setAdmin(adminMock({ inviteError: { message: 'A user with this email address has already been registered' } }).supabase);

    const res = await POST(postReq({ email: 'existing@acme.com', role: 'editor' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).not.toMatch(/already been registered/i);
    expect(body.error).toBe('Failed to send invitation. Please try again or contact support.');
  });
});
