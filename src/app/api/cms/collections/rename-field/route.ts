import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/activity';
import {
  checkRename,
  copyKeyInData,
  dropKeyInData,
  renameFieldInSchema,
  renameKeyInOptions,
} from '@/lib/collections/schema-changes';
import { validateFieldDefs } from '@/lib/collections/validate';
import type { Collection } from '@/lib/supabase/types';
import type { FieldDef } from '@/lib/collections/types';

/**
 * Renames a collection field's key, carrying every existing entry's content
 * across with it.
 *
 * ## Why this is a route and not a client-side loop
 *
 * The schema builder does its other work through direct PostgREST calls from
 * the browser, which is fine for operations that touch exactly one row. A
 * rename touches one `collections` row and N `collection_items` rows, and
 * the three phases below have to run in a fixed order to stay safe (see
 * `schema-changes.ts` for the invariant). Putting that sequence behind one
 * request means a closed tab or a lost connection interrupts it at a
 * defined point, rather than midway through a `for` loop in a component
 * that no longer exists.
 *
 * ## Why the user-scoped client, not the admin client
 *
 * Every write here is one an authorized user is already allowed to make, so
 * RLS is the authorization — `collections` writes are restricted to
 * `is_ne_admin() OR (client_id = my_client_id() AND role = 'client_admin')`
 * by migration 008, and `collection_items` writes are scoped by tenant. A
 * caller who cannot rename a field gets zero rows updated rather than a
 * privilege escalation, and no service-role key is anywhere near this
 * operation. The `ne_admin` check below is a clearer error message, not the
 * security boundary.
 *
 * ## Not transactional, but safe at every instant
 *
 * Supabase's client cannot wrap these statements in a transaction. The three
 * phases are ordered so that the key the schema currently names is always
 * populated, which means an interruption is recoverable by re-running rather
 * than something an editor can observe as data loss. The full argument lives
 * in `copyKeyInData`'s doc comment. If this ever needs to be truly atomic,
 * the shape to reach for is a `SECURITY INVOKER` plpgsql function so RLS
 * still applies — not the admin client.
 */

interface RenameBody {
  collectionId?: unknown;
  oldKey?: unknown;
  newKey?: unknown;
  newLabel?: unknown;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  let body: RenameBody;
  try {
    body = (await req.json()) as RenameBody;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const collectionId = asString(body.collectionId);
  const oldKey = asString(body.oldKey);
  const newKey = asString(body.newKey);
  const newLabel = asString(body.newLabel);

  if (!collectionId || !oldKey || !newKey) {
    return NextResponse.json({ error: 'collectionId, oldKey and newKey are all required.' }, { status: 400 });
  }

  const { data: row, error: loadError } = await supabase
    .from('collections')
    .select('*')
    .eq('id', collectionId)
    .single();

  // A collection the caller cannot see is indistinguishable from one that
  // does not exist, which is the same posture the revisions and preview
  // routes take: never let a caller probing ids learn which ones are real.
  if (loadError || !row) {
    return NextResponse.json({ error: 'Collection not found.' }, { status: 404 });
  }

  const collection = row as Collection;
  const fields: FieldDef[] = collection.fields ?? [];

  const check = checkRename(fields, oldKey, newKey);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const nextFields = renameFieldInSchema(fields, oldKey, newKey, newLabel || undefined);
  const validated = validateFieldDefs(nextFields);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.errors.join(' ') }, { status: 400 });
  }

  // Only `data` and `id` are needed; pulling whole rows would drag every
  // entry's rich text through memory for a key rename.
  const { data: entries, error: entriesError } = await supabase
    .from('collection_items')
    .select('id, data')
    .eq('collection_id', collectionId);

  if (entriesError) {
    return NextResponse.json({ error: entriesError.message }, { status: 500 });
  }

  const rows = (entries ?? []) as { id: string; data: Record<string, unknown> | null }[];

  // Phase 1 — write the new key alongside the old one. The schema still
  // names the old key and it is still populated, so nothing is observable.
  let migrated = 0;
  for (const entry of rows) {
    const { data: nextData, changed } = copyKeyInData(entry.data, oldKey, newKey);
    if (!changed) continue;
    const { error } = await supabase.from('collection_items').update({ data: nextData }).eq('id', entry.id);
    if (error) {
      return NextResponse.json(
        {
          error: `Stopped while copying content to the new name: ${error.message}. Nothing was lost — the field still uses its old name. Try again.`,
          phase: 'copy',
          migrated,
        },
        { status: 500 },
      );
    }
    migrated += 1;
  }

  // Phase 2 — point the schema at the new key. It is populated everywhere by
  // now, so the editor never renders an empty field.
  const nextOptions = renameKeyInOptions(collection.options ?? {}, oldKey, newKey);
  const { error: schemaError } = await supabase
    .from('collections')
    .update({ fields: nextFields, options: nextOptions })
    .eq('id', collectionId);

  if (schemaError) {
    return NextResponse.json(
      {
        error: `Content was copied but the field could not be renamed: ${schemaError.message}. Nothing was lost — the field still uses its old name. Try again.`,
        phase: 'schema',
        migrated,
      },
      { status: 500 },
    );
  }

  // Phase 3 — cleanup. A failure here is cosmetic: the entry keeps a
  // duplicate under the old key that nothing reads, and a re-run clears it.
  // Deliberately does not fail the request.
  let cleaned = 0;
  for (const entry of rows) {
    const copied = copyKeyInData(entry.data, oldKey, newKey).data;
    const { data: nextData, changed } = dropKeyInData(copied, oldKey);
    if (!changed) continue;
    const { error } = await supabase.from('collection_items').update({ data: nextData }).eq('id', entry.id);
    if (!error) cleaned += 1;
  }

  await logActivity(supabase, {
    clientId: collection.client_id,
    actorId: user.id,
    action: 'updated',
    entityType: 'collection',
    entityId: collection.id,
    summary: `Renamed the "${oldKey}" field to "${newKey}" in ${collection.name}`,
    meta: { old_key: oldKey, new_key: newKey, entries_migrated: migrated },
  });

  return NextResponse.json({ ok: true, migrated, cleaned, total: rows.length });
}
