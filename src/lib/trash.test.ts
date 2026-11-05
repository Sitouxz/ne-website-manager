import { describe, expect, it, vi } from 'vitest';
import { daysUntilPurge, moveToTrash, restoreFromTrash, trashErrorMessage } from './trash';

const rpcReturning = (result: { data: unknown; error: unknown }) => ({ rpc: vi.fn().mockResolvedValue(result) });

describe('moveToTrash', () => {
  it('calls trash_item with the type and id and returns the trash id', async () => {
    const client = rpcReturning({ data: 'trash-1', error: null });
    const result = await moveToTrash(client, 'post', 'post-1');
    expect(client.rpc).toHaveBeenCalledWith('trash_item', { p_entity_type: 'post', p_id: 'post-1' });
    expect(result).toEqual({ trashId: 'trash-1', error: null });
  });

  it('shows the database guard message as-is', async () => {
    const client = rpcReturning({
      data: null,
      error: { code: '42501', message: 'Only an admin can delete content that is live on the website. Ask an admin to unpublish it first.' },
    });
    const result = await moveToTrash(client, 'post', 'post-1');
    expect(result.error).toMatch(/^Only an admin can delete content that is live/);
  });
});

describe('restoreFromTrash', () => {
  it('calls restore_item and returns the restored row', async () => {
    const client = rpcReturning({ data: { id: 'post-1', title: 'Back' }, error: null });
    const result = await restoreFromTrash(client, 'trash-1', 'post');
    expect(client.rpc).toHaveBeenCalledWith('restore_item', { p_trash_id: 'trash-1' });
    expect(result).toEqual({ row: { id: 'post-1', title: 'Back' }, error: null });
  });

  it('explains an RLS rejection on restore as an admin-only live restore', async () => {
    const client = rpcReturning({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "posts"' } });
    const result = await restoreFromTrash(client, 'trash-1', 'post');
    expect(result.error).toMatch(/only an admin can restore it/);
  });

  it('passes the URL clash message through', async () => {
    const client = rpcReturning({ data: null, error: { code: '23505', message: "Something else now uses this item's web address. Rename or remove it, then restore again." } });
    expect((await restoreFromTrash(client, 'trash-1')).error).toMatch(/web address/);
  });
});

describe('trashErrorMessage', () => {
  it('falls back to the shared friendly messages for anything else', () => {
    expect(trashErrorMessage(new TypeError('Failed to fetch'), 'page', 'delete')).toMatch(/internet connection/);
  });
});

describe('daysUntilPurge', () => {
  const day = 24 * 60 * 60 * 1000;
  it('counts down from 30 days and never goes negative', () => {
    const deletedAt = '2026-11-01T00:00:00Z';
    const t0 = new Date(deletedAt).getTime();
    expect(daysUntilPurge(deletedAt, t0)).toBe(30);
    expect(daysUntilPurge(deletedAt, t0 + 29.5 * day)).toBe(1);
    expect(daysUntilPurge(deletedAt, t0 + 40 * day)).toBe(0);
  });
});
