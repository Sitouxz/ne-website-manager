import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import { createAdminClient } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/activity';
import { GET } from './route';

type Fixtures = Record<string, unknown[]>;

/**
 * Wraps `mockSupabase` so tests can assert whether `.update()` was actually
 * invoked on the underlying query builder — the mock itself doesn't track
 * calls, so this wraps the returned builder's `update` method with a spy
 * while preserving its real (chainable) behavior.
 */
function setAdmin(fixtures: Fixtures = {}) {
  const base = mockSupabase(fixtures);
  const updateSpy = vi.fn();

  const admin = {
    from(table: string) {
      const builder = base.from(table);
      const originalUpdate = builder.update.bind(builder);
      builder.update = ((payload: Record<string, unknown>) => {
        updateSpy(table, payload);
        return originalUpdate(payload);
      }) as typeof builder.update;
      return builder;
    },
  };

  (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(admin);
  return { admin, updateSpy };
}

function getReq(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/cron/publish-scheduled', { headers });
}

const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

function duePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'due-1',
    client_id: 'client-1',
    title: 'Due Post',
    status: 'scheduled',
    scheduled_at: PAST,
    published_at: null,
    ...overrides,
  };
}

function notDuePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'not-due-1',
    client_id: 'client-1',
    title: 'Future Post',
    status: 'scheduled',
    scheduled_at: FUTURE,
    published_at: null,
    ...overrides,
  };
}

function draftPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    client_id: 'client-1',
    title: 'Draft with past scheduled_at (should never happen, but not due regardless)',
    status: 'draft',
    scheduled_at: PAST,
    published_at: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/cron/publish-scheduled — auth', () => {
  it('returns 401 and never attempts an update when the Authorization header is missing', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const { updateSpy } = setAdmin({ posts: [duePost()] });

    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns 401 and never attempts an update when the Authorization header is wrong', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const { updateSpy } = setAdmin({ posts: [duePost()] });

    const res = await GET(getReq({ authorization: 'Bearer wrong-secret' }));

    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns 401 (never a false-accept) when CRON_SECRET is unset on the server, even with a header sent', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { updateSpy } = setAdmin({ posts: [duePost()] });

    const res = await GET(getReq({ authorization: 'Bearer ' }));

    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns 401 when CRON_SECRET is unset and no header is sent at all', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { updateSpy } = setAdmin({ posts: [duePost()] });

    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/publish-scheduled — publishing', () => {
  it('publishes only due rows: correct secret, some due and some not', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const due = duePost();
    const notDue = notDuePost();
    const draft = draftPost();
    const { admin, updateSpy } = setAdmin({ posts: [due, notDue, draft] });

    const res = await GET(getReq({ authorization: 'Bearer correct-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(body.published).toBe(1);
    expect(body.ids).toEqual(['due-1']);

    const { data: allPosts } = await admin.from('posts').select('*');
    const rows = allPosts as Array<Record<string, unknown>>;

    const updated = rows.find((r) => r.id === 'due-1')!;
    expect(updated.status).toBe('published');
    expect(updated.scheduled_at).toBeNull();
    expect(updated.published_at).toBeTruthy();

    const stillScheduled = rows.find((r) => r.id === 'not-due-1')!;
    expect(stillScheduled.status).toBe('scheduled');
    expect(stillScheduled.scheduled_at).toBe(FUTURE);

    const stillDraft = rows.find((r) => r.id === 'draft-1')!;
    expect(stillDraft.status).toBe('draft');
  });

  it('logs one activity entry per published row with the right entityId and summary, and none for skipped rows', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    setAdmin({ posts: [duePost(), notDuePost(), draftPost()] });

    await GET(getReq({ authorization: 'Bearer correct-secret' }));

    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clientId: 'client-1',
        actorId: null,
        action: 'published',
        entityType: 'post',
        entityId: 'due-1',
        summary: 'Published "Due Post" (scheduled)',
      })
    );
  });

  it('returns 200 with published: 0 and never calls logActivity when no rows are due', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    setAdmin({ posts: [notDuePost(), draftPost()] });

    const res = await GET(getReq({ authorization: 'Bearer correct-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ published: 0, ids: [] });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('publishes multiple due rows across different clients in one run', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const dueA = duePost({ id: 'due-a', client_id: 'client-1', title: 'A' });
    const dueB = duePost({ id: 'due-b', client_id: 'client-2', title: 'B' });
    setAdmin({ posts: [dueA, dueB, notDuePost()] });

    const res = await GET(getReq({ authorization: 'Bearer correct-secret' }));
    const body = await res.json();

    expect(body.published).toBe(2);
    expect(body.ids.sort()).toEqual(['due-a', 'due-b']);
    expect(logActivity).toHaveBeenCalledTimes(2);
  });
});
