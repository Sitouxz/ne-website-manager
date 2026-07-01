import type { SupabaseClient } from '@supabase/supabase-js';
import type { Collection } from '@/lib/supabase/types';

/**
 * A collection record, normalized to a flat shape regardless of whether it's
 * backed by a typed table (native) or the generic `collection_items` JSONB
 * store. Every field in `def.fields` is available as a top-level key here —
 * this is the only place that hides the native-vs-generic storage split.
 */
export type CollectionRecord = {
  id: string;
  client_id: string;
  slug: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

/** Flattens a generic `collection_items` row so its `data` fields sit at the top level. */
export function fromGenericRow(row: Record<string, unknown>): CollectionRecord {
  const { data, ...rest } = row as { data?: Record<string, unknown> } & Record<string, unknown>;
  return { ...rest, ...(data ?? {}) } as CollectionRecord;
}

/** Builds a generic `collection_items` payload from a flat form object. */
function toGenericRow(def: Collection, form: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const field of def.fields) data[field.key] = form[field.key] ?? null;
  return {
    slug: (form.slug as string) ?? '',
    status: (form.status as string) ?? def.options.statusValues[0],
    data,
  };
}

/** Builds a native table payload (flat columns) from a flat form object. */
function toNativeRow(def: Collection, form: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  for (const field of def.fields) row[field.key] = form[field.key] ?? null;
  if (def.options.hasStatus) row.status = form.status ?? def.options.statusValues[0];
  return row;
}

function table(def: Collection) {
  return def.storage === 'native' ? def.native_table! : 'collection_items';
}

export async function listItems(
  sb: SupabaseClient,
  def: Collection,
  clientId: string | null
): Promise<CollectionRecord[]> {
  if (!clientId) return [];

  let query = sb.from(table(def)).select('*').eq('client_id', clientId);
  if (def.storage === 'generic') query = query.eq('collection_id', def.id);
  query = query.order('created_at', { ascending: false });

  const { data } = await query;
  const rows = (data as Record<string, unknown>[]) ?? [];
  return def.storage === 'generic' ? rows.map(fromGenericRow) : (rows as CollectionRecord[]);
}

export async function getItem(
  sb: SupabaseClient,
  def: Collection,
  id: string
): Promise<CollectionRecord | null> {
  let query = sb.from(table(def)).select('*').eq('id', id);
  if (def.storage === 'generic') query = query.eq('collection_id', def.id);

  const { data } = await query.maybeSingle();
  if (!data) return null;
  return def.storage === 'generic' ? fromGenericRow(data as Record<string, unknown>) : (data as CollectionRecord);
}

export async function createItem(
  sb: SupabaseClient,
  def: Collection,
  clientId: string,
  form: Record<string, unknown>
): Promise<{ data: CollectionRecord | null; error: string | null }> {
  const payload =
    def.storage === 'generic'
      ? { ...toGenericRow(def, form), collection_id: def.id, client_id: clientId }
      : { ...toNativeRow(def, form), client_id: clientId };

  const { data, error } = await sb.from(table(def)).insert(payload).select().single();
  if (error) return { data: null, error: error.message };
  return { data: def.storage === 'generic' ? fromGenericRow(data) : (data as CollectionRecord), error: null };
}

export async function updateItem(
  sb: SupabaseClient,
  def: Collection,
  id: string,
  form: Record<string, unknown>
): Promise<{ data: CollectionRecord | null; error: string | null }> {
  const payload = def.storage === 'generic' ? toGenericRow(def, form) : toNativeRow(def, form);

  let query = sb.from(table(def)).update(payload).eq('id', id);
  if (def.storage === 'generic') query = query.eq('collection_id', def.id);

  const { data, error } = await query.select().single();
  if (error) return { data: null, error: error.message };
  return { data: def.storage === 'generic' ? fromGenericRow(data) : (data as CollectionRecord), error: null };
}

export async function deleteItem(sb: SupabaseClient, def: Collection, id: string): Promise<{ error: string | null }> {
  let query = sb.from(table(def)).delete().eq('id', id);
  if (def.storage === 'generic') query = query.eq('collection_id', def.id);

  const { error } = await query;
  return { error: error?.message ?? null };
}
