import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

// `after()` normally defers its callback until after the response is sent.
// For tests, capture it so we can invoke it synchronously and assert on
// what it would have done, without needing a real Next.js request context.
let capturedAfter: (() => Promise<void>) | null = null;
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (fn: () => Promise<void>) => { capturedAfter = fn; },
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/publish', () => ({
  notifyPublish: vi.fn().mockResolvedValue(undefined),
}));

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyPublish } from '@/lib/publish';
import { POST } from './route';

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

const EDITOR = { id: 'user-editor', role: 'editor', client_id: 'client-1' };
const CLIENT_ADMIN = { id: 'user-ca', role: 'client_admin', client_id: 'client-1' };
const NE_ADMIN = { id: 'user-ne', role: 'ne_admin', client_id: null };

const CLIENT_ROW = {
  id: 'client-1',
  revalidate_url: 'https://example.com/api/revalidate',
  revalidate_secret: 'shh',
  deploy_hook: null,
};

function postReq(body: unknown) {
  return new Request('https://example.com/api/publish/notify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  capturedAfter = null;
});

describe('POST /api/publish/notify', () => {
  it('returns 401 when unauthenticated', async () => {
    setSupabase(supabaseFor(null, { profiles: [] }));

    const res = await POST(postReq({ clientId: 'client-1', event: 'content.published', entityType: 'post', entityId: 'p1' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 for a malformed payload (missing fields / invalid event)', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));

    const res = await POST(postReq({ clientId: 'client-1', event: 'not-a-real-event', entityType: 'post', entityId: 'p1' }));

    expect(res.status).toBe(400);
  });

  it('rejects an editor of a different client with 403, and never schedules notifyPublish', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));

    const res = await POST(postReq({ clientId: 'client-2', event: 'content.published', entityType: 'post', entityId: 'p1' }));

    expect(res.status).toBe(403);
    expect(capturedAfter).toBeNull();
  });

  it('allows an editor to trigger notify for their own client, deferred via after()', async () => {
    setSupabase(supabaseFor(EDITOR, { profiles: [EDITOR] }));

    const res = await POST(postReq({ clientId: 'client-1', event: 'content.published', entityType: 'post', entityId: 'p1', slug: 'hello' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    // Not called yet — genuinely deferred until after() would fire.
    expect(notifyPublish).not.toHaveBeenCalled();
    expect(capturedAfter).not.toBeNull();
  });

  it('allows an ne_admin to trigger notify for any client', async () => {
    setSupabase(supabaseFor(NE_ADMIN, { profiles: [NE_ADMIN] }));

    const res = await POST(postReq({ clientId: 'client-2', event: 'content.updated', entityType: 'page', entityId: 'pg1' }));

    expect(res.status).toBe(200);
    expect(capturedAfter).not.toBeNull();
  });

  it('the deferred callback loads the client row via the admin client and calls notifyPublish with it', async () => {
    const admin = mockSupabase({ clients: [CLIENT_ROW] });
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));

    const res = await POST(postReq({
      clientId: 'client-1', event: 'content.published', entityType: 'post', entityId: 'p1', slug: 'hello',
    }));
    expect(res.status).toBe(200);

    expect(capturedAfter).not.toBeNull();
    await capturedAfter!();

    expect(notifyPublish).toHaveBeenCalledTimes(1);
    const [clientArg, paramsArg, supabaseArg] = (notifyPublish as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(clientArg).toMatchObject({ id: 'client-1', revalidate_url: CLIENT_ROW.revalidate_url });
    expect(paramsArg).toMatchObject({ event: 'content.published', entityType: 'post', entityId: 'p1', slug: 'hello' });
    expect(supabaseArg).toBe(admin);
  });

  it('the deferred callback is a no-op (never calls notifyPublish) when the client row cannot be found', async () => {
    const admin = mockSupabase({ clients: [] });
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
    setSupabase(supabaseFor(CLIENT_ADMIN, { profiles: [CLIENT_ADMIN] }));

    const res = await POST(postReq({ clientId: 'client-1', event: 'content.published', entityType: 'post', entityId: 'p1' }));
    expect(res.status).toBe(200);

    await capturedAfter!();

    expect(notifyPublish).not.toHaveBeenCalled();
  });
});
