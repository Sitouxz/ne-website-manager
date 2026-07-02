/**
 * Fire-and-forget audit-trail logger for `public.activity_log`.
 *
 * `logActivity` must never throw and must never propagate a rejected
 * promise — a failure to record an activity entry should never break the
 * mutation it's describing. Errors (from a bad insert, a thrown client, or
 * a missing `clientId`) are reported via `console.error` only.
 */

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'published'
  | 'archived'
  | 'deleted'
  | (string & {});

export type ActivityEntityType =
  | 'post'
  | 'page'
  | 'property'
  | 'media'
  | 'collection_entry'
  | 'form'
  | 'member'
  | 'settings'
  | (string & {});

export interface LogActivityParams {
  clientId: string | null | undefined;
  actorId: string | null | undefined;
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId?: string | null;
  summary: string;
  meta?: Record<string, unknown>;
}

/** Minimal shape of what `logActivity` needs from a Supabase client. */
interface ActivityLogClient {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
}

export async function logActivity(
  supabase: ActivityLogClient,
  params: LogActivityParams
): Promise<void> {
  if (!params.clientId) {
    console.error('logActivity: skipped insert — missing clientId', params);
    return;
  }

  try {
    const { error } = await supabase.from('activity_log').insert({
      client_id: params.clientId,
      actor_id: params.actorId ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      summary: params.summary,
      meta: params.meta ?? {},
    });

    if (error) {
      console.error('logActivity: insert failed', error);
    }
  } catch (err) {
    console.error('logActivity: unexpected error', err);
  }
}
