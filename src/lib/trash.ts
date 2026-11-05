/**
 * Client-side wrappers for the trash RPCs (migration 029).
 *
 * `trash_item` / `restore_item` are SECURITY INVOKER Postgres functions, so
 * every rule — tenant scoping, "only admins delete live content", "only
 * admins restore something that comes back published" — is enforced in the
 * database. This module only calls them and turns their errors into words.
 */

import { errorMessage } from '@/lib/errors';

export type TrashEntityType = 'post' | 'page' | 'property' | 'collection_entry';

export interface TrashRow {
  id: string;
  client_id: string;
  entity_type: TrashEntityType;
  entity_id: string;
  title: string;
  snapshot: Record<string, unknown>;
  deleted_by: string | null;
  deleted_at: string;
}

/** Days a trashed item is kept before the daily cron removes it for good. */
export const TRASH_RETENTION_DAYS = 30;

/** Minimal client shape: just `.rpc`, so the real client and test doubles both fit. */
export interface TrashRpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

const ENTITY_NOUN: Record<TrashEntityType, string> = {
  post: 'post',
  page: 'page',
  property: 'property',
  collection_entry: 'entry',
};

export function entityNoun(type: TrashEntityType): string {
  return ENTITY_NOUN[type];
}

/**
 * Messages raised by migration 029's functions are written for the person
 * reading them, so they are shown as-is rather than flattened into the
 * generic "you don't have permission" copy.
 */
const AUTHORED_MESSAGES = [
  /^Only an admin can delete content that is live/,
  /^Only an admin can permanently delete/,
  /^That item (no longer exists|is no longer in the trash)/,
  /^Something else now uses this item's web address/,
  /^This item belonged to something that has since been deleted/,
  /^You do not have permission to delete this item/,
];

function rawMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return err instanceof Error ? err.message : '';
}

/** Readable message for a failed trash, restore or purge. */
export function trashErrorMessage(err: unknown, type: TrashEntityType | null, action: 'delete' | 'restore'): string {
  const message = rawMessage(err);
  if (AUTHORED_MESSAGES.some((pattern) => pattern.test(message))) return message;
  // On restore, a plain RLS rejection means the row would come back live and
  // the caller isn't an admin (015's WITH CHECK on the re-insert).
  if (action === 'restore' && /row-level security/i.test(message)) {
    return 'This was live on the website when it was deleted, so only an admin can restore it.';
  }
  return errorMessage(err, { entity: type ? entityNoun(type) : 'item', action: action === 'delete' ? 'delete' : 'save' });
}

/** Moves one item to the trash. Returns the trash row id, needed for Undo. */
export async function moveToTrash(
  supabase: TrashRpcClient,
  type: TrashEntityType,
  id: string,
): Promise<{ trashId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('trash_item', { p_entity_type: type, p_id: id });
  if (error) return { trashId: null, error: trashErrorMessage(error, type, 'delete') };
  return { trashId: typeof data === 'string' ? data : null, error: null };
}

/** Restores one trashed item. Returns the restored row as it now exists. */
export async function restoreFromTrash(
  supabase: TrashRpcClient,
  trashId: string,
  type: TrashEntityType | null = null,
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await supabase.rpc('restore_item', { p_trash_id: trashId });
  if (error) return { row: null, error: trashErrorMessage(error, type, 'restore') };
  return { row: data && typeof data === 'object' ? (data as Record<string, unknown>) : null, error: null };
}

/** Whole days left before an item deleted at `deletedAt` is purged; never negative. */
export function daysUntilPurge(deletedAt: string, nowMs: number = Date.now()): number {
  const purgeAt = new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - nowMs) / (24 * 60 * 60 * 1000)));
}

/** Minimal shape the purge needs; satisfied by the service-role client and `mockSupabase`. */
export interface TrashPurgeClient {
  from(table: 'trash'): {
    delete(): {
      lte(column: 'deleted_at', value: string): {
        select(columns: 'id'): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Permanently removes trash rows older than the retention window. Run with
 * the service-role client from the daily cron; the purge guard in migration
 * 029 lets the service role through and no one else without admin rights.
 */
export async function purgeExpiredTrash(
  admin: TrashPurgeClient,
  nowMs: number = Date.now(),
): Promise<{ purged: number; error: string | null }> {
  const cutoff = new Date(nowMs - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from('trash').delete().lte('deleted_at', cutoff).select('id');
  if (error) return { purged: 0, error: error.message };
  return { purged: data?.length ?? 0, error: null };
}
