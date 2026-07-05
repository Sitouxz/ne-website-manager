'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Save, Send, Loader2, History, X, AlertCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { logActivity } from '@/lib/activity';
import { firePublishNotify, computeLivePath } from '@/lib/publish-client';
import FieldInput from '@/components/collections/FieldInput';
import { validateEntry } from '@/lib/collections/validate';
import type { Collection, CollectionItem, CollectionItemStatus } from '@/lib/supabase/types';

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  published: 'Published',
  archived: 'Archived',
};

const REVISION_SNAPSHOT_INTERVAL_MS = 60_000;

interface FormState {
  slug: string;
  status: CollectionItemStatus;
  data: Record<string, unknown>;
}

const EMPTY_FORM: FormState = { slug: '', status: 'draft', data: {} };

interface RevisionListItem {
  id: string;
  created_at: string;
  author_id: string | null;
  author_name?: string;
  snapshot: Record<string, unknown>;
}

/**
 * Generic entry editor — Task 4.3. Mirrors the post editor's
 * (`src/app/(app)/cms/posts/[id]/page.tsx`, Task 3.3) autosave / 60s-throttled
 * revision snapshot / revision-history-with-restore / activity-log maturity,
 * adapted from a fixed field set to a dynamic `FieldDef[]` rendered via
 * `FieldInput`.
 *
 * No `isNew` branch: unlike the post/page/property editors, entries are
 * always created by the entries list page
 * (`src/app/(app)/cms/collections/[id]/page.tsx`) via the same thin
 * "create a minimal draft row, then redirect here" pattern Phase 3
 * established — so `entryId` is always a real, already-persisted
 * `collection_items.id` by the time this component mounts.
 *
 * Validation: `validateEntry(collection.fields, form.data)` gates the
 * transition to `published` only — Draft saves (and autosave) never
 * validate. Rationale: a draft is explicitly a work-in-progress state (the
 * post editor already lets "Save Draft" persist an empty title with no
 * validation at all), and the moment invalid data would actually become
 * visible through the public API is exactly the moment it flips to
 * `published` — that's the one save path this editor gates on validity.
 * Autosave never blocks on validation for the same reason it never blocks
 * on anything else the user hasn't explicitly submitted: it persists
 * whatever's currently in the form so a stray tab-close never loses work,
 * regardless of whether that in-progress state would pass validation.
 */
export default function CollectionEntryEditor({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { id: collectionId, entryId } = use(params);

  const [loading,       setLoading]       = useState(true);
  const [collection,    setCollection]    = useState<Collection | null>(null);
  const [notFound,      setNotFound]      = useState(false);
  const [clientId,      setClientId]      = useState<string | null>(null);
  const [form,          setForm]          = useState<FormState>({ ...EMPTY_FORM });
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [error,         setError]         = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [historyOpen,   setHistoryOpen]   = useState(false);
  // Whether this user's role is allowed to publish an entry at all
  // (`client_admin`/`ne_admin`, per migration 015_publish_rls.sql's
  // `WITH CHECK` on `collection_items`). UX nicety only — the real
  // boundary is the RLS policy; this just hides/disables the control
  // before a plain `editor` submits a save RLS would reject anyway, same
  // convention as the role-gating in Tasks 4.2/5.3. `archived` is
  // deliberately not gated here — see the migration's comment: archiving
  // takes something down, it doesn't publish anything.
  const [canPublish, setCanPublish] = useState(false);
  // The entry's status as currently persisted in the database — set only
  // from data actually loaded from (or successfully written to)
  // `collection_items`, never from `form.status` while a user is mid-edit.
  // Kept separate from `form.status` on purpose: an `editor` can freely
  // flip the in-memory dropdown to `'draft'` (or `'archived'`) while
  // viewing an already-published entry, but that alone must never
  // unlock a save action that would downgrade the row. `isElevatedLocked`
  // below gates on this value, and also gates the "Archived" option in
  // the status <select>: migration 015's own WITH CHECK doesn't block a
  // NEW status of `archived` in isolation, but archiving a row whose
  // *currently-persisted* status is already `published` is a de-facto
  // unpublish, correctly blocked for a non-admin by migration 016's
  // elevated -> non-elevated trigger guard. An editor viewing a
  // currently-draft entry is unaffected — `isElevatedLocked` is false
  // there, so archiving stays fully available.
  const [initialStatus, setInitialStatus] = useState<CollectionItemStatus | null>(null);

  const skipNextAutosaveRef = useRef(true);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRevisionSnapshotAtRef = useRef(0);

  function applyItemToForm(item: CollectionItem) {
    skipNextAutosaveRef.current = true;
    const status = item.status ?? 'draft';
    setForm({
      slug: item.slug ?? '',
      status,
      data: item.data ?? {},
    });
    // `item` here is always the row as it currently exists in the DB (a
    // fresh fetch on load, or the server's post-restore row) — so this is
    // "the status this row has right now", independent of whatever the
    // user goes on to pick in the dropdown afterward.
    setInitialStatus(status);
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      setNotFound(false);
      const supabase = createClient();

      const { data: coll } = await supabase.from('collections').select('*').eq('id', collectionId).single();
      if (!coll) { setNotFound(true); setLoading(false); return; }
      setCollection(coll as Collection);

      const { data: item } = await supabase.from('collection_items').select('*').eq('id', entryId).single();
      if (!item || item.collection_id !== collectionId) { setNotFound(true); setLoading(false); return; }

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        setCanPublish(profile?.role === 'ne_admin' || profile?.role === 'client_admin');
      }

      setClientId(item.client_id);
      applyItemToForm(item as CollectionItem);
      setLoading(false);
    }
    load();
  }, [collectionId, entryId]);

  const buildContentPayload = useCallback((f: FormState) => ({
    slug: f.slug.trim() || 'untitled-entry',
    data: f.data,
  }), []);

  async function maybeSnapshotRevision(
    supabase: ReturnType<typeof createClient>,
    authorId: string,
    snapshot: Record<string, unknown>,
    force: boolean
  ) {
    const now = Date.now();
    if (!force && now - lastRevisionSnapshotAtRef.current < REVISION_SNAPSHOT_INTERVAL_MS) return;
    lastRevisionSnapshotAtRef.current = now;
    if (!clientId) return;
    await supabase.from('revisions').insert({
      client_id: clientId,
      entity_type: 'collection_entry',
      entity_id: entryId,
      snapshot,
      author_id: authorId,
    });
  }

  // Autosave: debounced 2s after the last edit to slug/data — never status,
  // mirroring the post editor's rule that autosave can only ever persist
  // content, never flip a status/publish transition a user hasn't
  // explicitly requested.
  useEffect(() => {
    if (loading || !clientId) return;
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return; }

    setAutosaveState('idle');

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      setAutosaveState('saving');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAutosaveState('error'); return; }

      const payload = buildContentPayload(form);
      const { error: err } = await supabase.from('collection_items').update(payload).eq('id', entryId);
      if (err) { setAutosaveState('error'); return; }

      setAutosaveState('saved');
      await maybeSnapshotRevision(supabase, user.id, payload, false);
    }, 2000);

    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.slug, form.data]);

  async function handleSave(statusOverride?: CollectionItemStatus) {
    if (!collection) return;
    const status = statusOverride ?? form.status;

    if (status === 'published') {
      const result = validateEntry(collection.fields, form.data);
      if (!result.ok) {
        setValidationErrors(result.errors);
        setError('Fix the highlighted fields before publishing.');
        return;
      }
    }
    setValidationErrors({});
    setError('');
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not authenticated'); setSaving(false); return; }

    const previousStatus = form.status;
    const payload: Record<string, unknown> = {
      ...buildContentPayload(form),
      status,
      ...(status === 'published' && previousStatus !== 'published' ? { published_at: new Date().toISOString() } : {}),
    };

    const { error: err } = await supabase.from('collection_items').update(payload).eq('id', entryId);
    if (err) { setError(err.message); setSaving(false); return; }

    if (status === 'published') {
      // Fresh publish (draft -> published) vs. an edit to already-published
      // content — mirrors the `action` mapping for logActivity just below.
      firePublishNotify({
        clientId: clientId!,
        event: previousStatus === 'published' ? 'content.updated' : 'content.published',
        entityType: 'collection_entry',
        entityId: entryId,
        slug: payload.slug as string,
        path: computeLivePath('collection_entry', { slug: payload.slug as string, collectionSlug: collection.slug }),
      });
    }

    const action = previousStatus !== status
      ? (status === 'published' ? 'published' : status === 'archived' ? 'archived' : 'updated')
      : 'updated';
    await logActivity(supabase, {
      clientId,
      actorId: user.id,
      action,
      entityType: 'collection_entry',
      entityId: entryId,
      summary: `${ACTIVITY_LABELS[action]} "${payload.slug}"`,
    });
    await maybeSnapshotRevision(supabase, user.id, payload, true);

    setForm((f) => ({ ...f, status }));
    // The write above just succeeded, so `status` is now what's actually
    // live in the DB — keep `initialStatus` in sync so a subsequent save
    // in the same session gates on the row's real current state.
    setInitialStatus(status);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return (
      <>
        <Topbar title="Entry" subtitle="Loading..." />
        <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  if (notFound || !collection) {
    return (
      <>
        <Topbar title="Entry" />
        <div className="page-body">
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--fg3)' }}>
            Entry not found.
            <div style={{ marginTop: 16 }}>
              <Link href="/cms/collections" className="btn-outline-ne"><ArrowLeft size={14} /> Back to Collections</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (collection.storage !== 'generic' || collection.client_id === null) {
    return (
      <>
        <Topbar title={collection.name} subtitle="Entry" />
        <div className="page-body">
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--fg3)' }}>
            Entry editing isn&apos;t available for {collection.client_id === null ? 'global/system' : 'native'} collections.
            <div style={{ marginTop: 16 }}>
              <Link href="/cms/collections" className="btn-outline-ne"><ArrowLeft size={14} /> Back to Collections</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  // A plain `editor` (not `canPublish`) can never downgrade an entry whose
  // *currently-persisted* status is already published — this covers both
  // an explicit `draft` and an explicit `archived` target status, since
  // migration 016's trigger blocks the elevated -> non-elevated
  // transition regardless of which non-elevated status is being written
  // to (015's own `WITH CHECK` doesn't gate a NEW status of `archived` in
  // isolation, but the combined, practical behavior is that archiving an
  // already-published row requires admin, same as any other unpublish).
  // Keyed off `initialStatus` (the DB's last-known value), not
  // `form.status`: an editor selecting "Draft" or "Archived" in the
  // dropdown while viewing an already-published entry must not unlock
  // either save action below, and the "Archived" option itself is
  // disabled in that case (see the status <select> below) so there's no
  // dead, misleading control that would only fail at save time. Never
  // blocks client_admin/ne_admin, and never disables "Archived" for an
  // editor viewing a currently-draft entry (archiving that is allowed).
  const isElevatedLocked = !canPublish && initialStatus === 'published';
  const elevatedLockedTitle = isElevatedLocked
    ? 'Only an admin can change the status of an already-published entry.'
    : undefined;

  const titleField = collection.options?.title_field;
  const derivedTitle = (titleField && typeof form.data[titleField] === 'string' && (form.data[titleField] as string).trim() !== '')
    ? (form.data[titleField] as string)
    : (form.slug || '(untitled)');

  return (
    <>
      <Topbar title={collection.name_singular || 'Entry'} subtitle={derivedTitle} />
      <div className="page-body">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <Link href={`/cms/collections/${collectionId}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to {collection.name}
          </Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {error && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>{error}</div>}
            {autosaveState === 'error' && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>
                Autosave failed — your last change may not be saved. Use Save Draft to be sure.
              </div>
            )}
            {(autosaveState === 'saving' || autosaveState === 'saved') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)' }}>
                {autosaveState === 'saving'
                  ? <><Loader2 size={12} style={{ animation: 'spin .6s linear infinite' }} /> Saving…</>
                  : 'All changes saved'}
              </div>
            )}
            {saved && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#DCFCE7', borderRadius: 'var(--r-sm)' }}>Saved</div>}
            <button className="btn-outline-ne" onClick={() => setHistoryOpen(true)} title="Revision history">
              <History size={14} /> History
            </button>
            <button
              className="btn-outline-ne"
              onClick={() => handleSave('draft')}
              disabled={saving || isElevatedLocked}
              title={elevatedLockedTitle}
            >
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
              Save Draft
            </button>
            {/* Publish shortcut: hidden entirely for `editor` — RLS
                (migration 015) rejects any save that leaves `status =
                'published'` unless the caller is client_admin/ne_admin.
                "Save Draft" above (and the "Archive Entry" action in the
                sidebar below) remain accessible for an editor viewing a
                currently-draft entry; both are disabled (`isElevatedLocked`)
                when the entry's currently-persisted status is already
                `published`, since any save in that state — including
                picking "Archived" — is a de-facto unpublish, correctly
                blocked for a non-admin by migration 016's trigger. */}
            {canPublish && (
              <button className="btn-ne" onClick={() => handleSave('published')} disabled={saving}>
                {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Send size={14} />}
                {form.status === 'published' ? 'Update' : 'Publish'}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
          {/* Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {collection.fields.length === 0 ? (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 32, textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>
                This collection has no fields defined yet.{' '}
                <Link href={`/cms/collections/${collectionId}/schema`} style={{ color: 'var(--ne-blue)', fontWeight: 600 }}>Add fields</Link> to start entering content.
              </div>
            ) : collection.fields.map((f) => (
              <div key={f.key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '16px 20px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: 'var(--fg2)', marginBottom: 10 }}>
                  {f.label}
                  {f.required && <span style={{ color: 'var(--ne-danger)' }}>*</span>}
                </label>
                <FieldInput
                  def={f}
                  value={form.data[f.key]}
                  onChange={(v) => setForm((prev) => ({ ...prev, data: { ...prev.data, [f.key]: v } }))}
                />
                {f.help && <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 8 }}>{f.help}</div>}
                {validationErrors[f.key] && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ne-danger)', marginTop: 8 }}>
                    <AlertCircle size={13} /> {validationErrors[f.key]}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Entry Settings</div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Slug</label>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--ne-blue)', fontFamily: 'monospace', background: 'var(--surface)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Status</label>
                  {/* Draft is always available to `editor`. Published is
                      hidden for `editor`; if an admin already published this
                      entry, a disabled option keeps the displayed status
                      accurate instead of silently showing "Draft" as
                      selected. Archived is available to `editor` UNLESS
                      `isElevatedLocked` — RLS's own WITH CHECK (migration
                      015) doesn't gate a NEW status of `archived` for this
                      table in isolation, but archiving an entry whose
                      *currently-persisted* status is already `published` is
                      a de-facto unpublish and is correctly blocked for a
                      non-admin by migration 016's elevated -> non-elevated
                      trigger guard — so the option is disabled here too,
                      matching the save actions below, rather than leaving a
                      selectable control that would only fail at save time.
                      This never disables Archived for an editor viewing a
                      currently-draft entry (`isElevatedLocked` is false
                      there). */}
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as CollectionItemStatus })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}
                  >
                    <option value="draft">Draft</option>
                    {canPublish ? (
                      <option value="published">Published</option>
                    ) : form.status === 'published' && (
                      <option value="published" disabled>Published</option>
                    )}
                    <option value="archived" disabled={isElevatedLocked}>Archived</option>
                  </select>
                </div>
                <button
                  className="btn-ne"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => handleSave()}
                  // Disabled whenever `isElevatedLocked` — keyed off
                  // `initialStatus` (the DB's currently-persisted value),
                  // not `form.status`, so selecting "Draft" (or "Archived")
                  // in the dropdown above while viewing an already-published
                  // entry can't unlock this button — mirrors the post/page
                  // editors' equivalent guard. Archiving an already-published
                  // entry is a de-facto unpublish and is correctly blocked
                  // for a non-admin by migration 016's trigger, so this
                  // button (and the Archived option itself, above) is
                  // disabled in that case too. An editor viewing a
                  // currently-draft entry is unaffected: `isElevatedLocked`
                  // is false there, so archiving stays fully available.
                  disabled={saving || isElevatedLocked}
                  title={elevatedLockedTitle}
                >
                  <Send size={14} />
                  {form.status === 'published' ? 'Update Entry' : form.status === 'archived' ? 'Archive Entry' : 'Save as Draft'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <RevisionPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        entryId={entryId}
        onRestore={(row) => applyItemToForm(row as unknown as CollectionItem)}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

/**
 * Right-side slide-in revision history drawer — same hand-rolled overlay
 * pattern as the post editor's `RevisionPanel` (not shared as a common
 * component since the post editor doesn't export one either; duplicating a
 * ~100-line drawer isn't worth introducing a shared component for two call
 * sites that differ only in `entity_type`/`entity_id`/restore-callback).
 */
function RevisionPanel({
  open, onClose, entryId, onRestore,
}: {
  open: boolean;
  onClose: () => void;
  entryId: string;
  onRestore: (row: Record<string, unknown>) => void;
}) {
  const [revisions, setRevisions] = useState<RevisionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/cms/revisions?entity_type=collection_entry&entity_id=${entryId}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? 'Failed to load revision history');
        if (!cancelled) setRevisions(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load revision history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, entryId]);

  async function handleRestore(revisionId: string) {
    if (!window.confirm('Restore this version? The current state will be saved as a revision first, so this can be undone.')) return;

    setRestoringId(revisionId);
    setError('');
    try {
      const res = await fetch('/api/cms/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: 'collection_entry', entity_id: entryId, revision_id: revisionId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Failed to restore revision');
      onRestore(body);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore revision');
    } finally {
      setRestoringId(null);
    }
  }

  if (!open) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200 }} onClick={onClose}>
      <div
        style={{
          position: 'fixed', top: 0, bottom: 0, right: 0, width: 380, maxWidth: '92vw',
          background: 'var(--surface)', borderLeft: '1px solid var(--border)',
          boxShadow: '-16px 0 48px rgba(0,0,0,.15)', display: 'flex', flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Revision History</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
              <Loader2 size={18} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
            </div>
          )}
          {error && (
            <div style={{ padding: '8px 12px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 12.5, marginBottom: 10 }}>
              {error}
            </div>
          )}
          {!loading && revisions.length === 0 && !error && (
            <div style={{ fontSize: 13, color: 'var(--fg3)', textAlign: 'center', padding: '30px 0' }}>
              No revisions yet.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {revisions.map((rev) => (
              <div key={rev.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--fg1)' }}>
                  {new Date(rev.created_at).toLocaleString()}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 8 }}>
                  {rev.author_name ?? 'Unknown'}
                </div>
                <button
                  className="btn-outline-ne"
                  style={{ fontSize: 12, padding: '5px 10px' }}
                  onClick={() => handleRestore(rev.id)}
                  disabled={restoringId === rev.id}
                >
                  {restoringId === rev.id ? <Loader2 size={12} style={{ animation: 'spin .6s linear infinite' }} /> : null}
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
