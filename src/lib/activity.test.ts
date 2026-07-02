import { describe, expect, it, vi, afterEach } from 'vitest';
import { mockSupabase } from '@/test/supabase-mock';
import { logActivity } from './activity';

describe('logActivity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts a row with the expected shape', async () => {
    const supabase = mockSupabase({ activity_log: [] });

    await logActivity(supabase, {
      clientId: 'client-1',
      actorId: 'user-1',
      action: 'published',
      entityType: 'post',
      entityId: 'post-1',
      summary: 'Published "Ramadan Schedule 2026"',
    });

    const { data } = await supabase.from('activity_log').select('*');
    expect(data).toHaveLength(1);
    expect(data?.[0]).toMatchObject({
      client_id: 'client-1',
      actor_id: 'user-1',
      action: 'published',
      entity_type: 'post',
      entity_id: 'post-1',
      summary: 'Published "Ramadan Schedule 2026"',
      meta: {},
    });
  });

  it('defaults meta to an empty object when not provided', async () => {
    const supabase = mockSupabase({ activity_log: [] });

    await logActivity(supabase, {
      clientId: 'client-1',
      actorId: 'user-1',
      action: 'created',
      entityType: 'property',
      entityId: 'prop-1',
      summary: 'Created property',
    });

    const { data } = await supabase.from('activity_log').select('*');
    expect(data?.[0]?.meta).toEqual({});
  });

  it('passes meta through when provided', async () => {
    const supabase = mockSupabase({ activity_log: [] });

    await logActivity(supabase, {
      clientId: 'client-1',
      actorId: null,
      action: 'deleted',
      entityType: 'post',
      entityId: 'post-2',
      summary: 'Deleted post',
      meta: { reason: 'spam' },
    });

    const { data } = await supabase.from('activity_log').select('*');
    expect(data?.[0]?.meta).toEqual({ reason: 'spam' });
  });

  it('never throws and swallows insert errors reported via { error }', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badSupabase = {
      from: () => ({
        insert: async () => ({ error: { message: 'insert failed' } }),
      }),
    };

    await expect(
      logActivity(badSupabase, {
        clientId: 'client-1',
        actorId: 'user-1',
        action: 'created',
        entityType: 'post',
        entityId: 'post-1',
        summary: 'x',
      })
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
  });

  it('never throws when the insert call itself rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const throwingSupabase = {
      from: () => ({
        insert: async () => {
          throw new Error('network down');
        },
      }),
    };

    await expect(
      logActivity(throwingSupabase, {
        clientId: 'client-1',
        actorId: 'user-1',
        action: 'created',
        entityType: 'post',
        entityId: 'post-1',
        summary: 'x',
      })
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
  });

  it('never throws when .from() itself throws synchronously', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenSupabase = {
      from: () => {
        throw new Error('client not configured');
      },
    };

    await expect(
      logActivity(brokenSupabase, {
        clientId: 'client-1',
        actorId: 'user-1',
        action: 'created',
        entityType: 'post',
        entityId: 'post-1',
        summary: 'x',
      })
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
  });

  it('skips the insert and does not throw when clientId is missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const insert = vi.fn();
    const supabase = { from: () => ({ insert }) };

    await expect(
      logActivity(supabase, {
        clientId: null,
        actorId: 'user-1',
        action: 'created',
        entityType: 'post',
        entityId: 'post-1',
        summary: 'x',
      })
    ).resolves.toBeUndefined();

    expect(insert).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });
});
