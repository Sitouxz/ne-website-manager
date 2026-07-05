'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useEffect, useState, use, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Save, Send, X, Loader2, History, Globe, Lock,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { logActivity } from '@/lib/activity';
import RichTextEditor from '@/components/editor/RichTextEditor';
import type { PageStatus } from '@/lib/supabase/types';

// Shares the same *meaning* as the post editor's `ACTIVITY_LABELS`
// (`src/app/(app)/cms/posts/[id]/page.tsx`) for the actions the two editors
// have in common — deliberately not imported/shared as a single constant
// (pages have no `scheduled`/`archived` transitions, so a shared map would
// carry dead entries for one side or the other), but kept in sync in meaning:
// 'created'/'updated'/'published' mean the same thing here as there.
const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  published: 'Published',
};

interface FormState {
  title: string;
  path: string;
  content: string;
  contentJson: Record<string, unknown> | null;
  status: PageStatus;
  visibility: 'public' | 'private';
  seoTitle: string;
  seoDesc: string;
}

const EMPTY_FORM: FormState = {
  title: '', path: '', content: '', contentJson: null,
  status: 'draft', visibility: 'public',
  seoTitle: '', seoDesc: '',
};

const REVISION_SNAPSHOT_INTERVAL_MS = 60_000;

interface RevisionListItem {
  id: string;
  created_at: string;
  author_id: string | null;
  author_name?: string;
  snapshot: Record<string, unknown>;
}

export default function PageEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew  = id === 'new';
  const router = useRouter();

  const [form,        setForm]      = useState<FormState>({ ...EMPTY_FORM });
  const [loading,     setLoading]   = useState(!isNew);
  const [saving,      setSaving]    = useState(false);
  const [saved,       setSaved]     = useState(false);
  const [error,       setError]     = useState('');
  const [clientId,    setClientId]  = useState<string | null>(null);
  const [isAdmin,     setIsAdmin]   = useState(false);
  // Whether this user's role is allowed to publish a page at all
  // (`client_admin`/`ne_admin`, per migration 015_publish_rls.sql's
  // `WITH CHECK` on `pages`). UX nicety only — the real boundary is the
  // RLS policy; this just hides/disables the control before a plain
  // `editor` submits a save RLS would reject anyway, same convention as
  // the role-gating in Tasks 4.2/5.3.
  const [canPublish, setCanPublish] = useState(false);
  // The page's status as currently persisted in the database — set only
  // from data actually loaded from (or successfully written to) `pages`,
  // never from `form.status` while a user is mid-edit. Kept separate from
  // `form.status` on purpose: an `editor` can freely flip the in-memory
  // dropdown to `'draft'` while viewing an already-published page, but
  // that alone must never unlock a save action that would downgrade the
  // row RLS (migration 015) reserves for client_admin/ne_admin — see
  // `isElevatedLocked` below, which gates on this value.
  const [initialStatus, setInitialStatus] = useState<PageStatus | null>(null);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
  const { selectedClientId } = useSelectedClient();

  // Guards against autosave firing in response to *this component* setting
  // `form` itself (initial load from the DB, or a revision restore) rather
  // than a genuine user edit. See the `useEffect` below — same pattern as
  // the post editor.
  const skipNextAutosaveRef = useRef(true);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRevisionSnapshotAtRef = useRef(0);

  function applyPageToForm(page: Record<string, unknown>) {
    skipNextAutosaveRef.current = true;
    const status = (page.status as PageStatus) ?? 'draft';
    setForm({
      title:       (page.title as string) ?? '',
      path:        (page.path as string) ?? '',
      content:     (page.content as string) ?? '',
      contentJson: (page.content_json as Record<string, unknown> | null) ?? null,
      status,
      visibility:  (page.visibility as 'public' | 'private') ?? 'public',
      seoTitle:    (page.seo_title as string) ?? '',
      seoDesc:     (page.seo_description as string) ?? '',
    });
    // `page` here is always the row as it currently exists in the DB (a
    // fresh fetch on load, or the server's post-restore row) — so this is
    // "the status this row has right now", independent of whatever the user
    // goes on to pick in the dropdown afterward.
    setInitialStatus(status);
  }

  // Load existing page + client_id
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('client_id, role')
        .eq('id', user.id)
        .single();

      const admin = profile?.role === 'ne_admin';
      setIsAdmin(admin);
      setCanPublish(admin || profile?.role === 'client_admin');

      if (admin) {
        if (isNew) setClientId(selectedClientId ?? null);
      } else {
        setClientId(profile?.client_id ?? null);
      }

      if (!isNew) {
        const { data: page } = await supabase
          .from('pages')
          .select('*')
          .eq('id', id)
          .single();

        if (page) {
          if (admin) setClientId(page.client_id);
          applyPageToForm(page);
        }
        setLoading(false);
      }
    }
    load();
  }, [id, isNew, selectedClientId]);

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /**
   * The content-only fields every save path (manual, autosave, restore)
   * writes — never status/visibility, mirroring the post editor's
   * `buildContentPayload`. Depends on nothing but its `f` argument.
   */
  const buildContentPayload = useCallback((f: FormState) => ({
    title:           f.title || '(Untitled)',
    path:            f.path || `/${slugify(f.title)}` || '/untitled',
    content:         f.content,
    content_json:    f.contentJson,
    seo_title:       f.seoTitle || null,
    seo_description: f.seoDesc  || null,
  }), []);

  /**
   * Writes a `revisions` row, throttled to at most once per
   * `REVISION_SNAPSHOT_INTERVAL_MS` — except when `force` is set, which
   * every explicit user action (manual save, status change, publish,
   * restore) always passes. Same pattern as the post editor.
   */
  async function maybeSnapshotRevision(
    supabase: ReturnType<typeof createClient>,
    authorId: string,
    entityId: string,
    cid: string,
    snapshot: Record<string, unknown>,
    force: boolean
  ) {
    const now = Date.now();
    if (!force && now - lastRevisionSnapshotAtRef.current < REVISION_SNAPSHOT_INTERVAL_MS) return;
    lastRevisionSnapshotAtRef.current = now;
    await supabase.from('revisions').insert({
      client_id: cid,
      entity_type: 'page',
      entity_id: entityId,
      snapshot,
      author_id: authorId,
    });
  }

  // Autosave: debounced 2s after the last content edit, for any existing
  // page (not `isNew` — there's no row to write to yet). The payload from
  // `buildContentPayload` never includes status/visibility, so autosave can
  // never flip those — same guarantee as the post editor.
  useEffect(() => {
    if (isNew || loading || !clientId) return;
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return; }

    // Hide any stale "All changes saved" (or "Autosave failed") from a
    // previous cycle the instant a new edit comes in.
    setAutosaveState('idle');

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      setAutosaveState('saving');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAutosaveState('error'); return; }

      const payload = buildContentPayload(form);
      const { error: err } = await supabase.from('pages').update(payload).eq('id', id);
      if (err) { setAutosaveState('error'); return; }

      setAutosaveState('saved');
      await maybeSnapshotRevision(supabase, user.id, id, clientId, payload, false);
    }, 2000);

    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
    // Deliberately depends on each content field individually (not `form` as
    // a whole, and excluding status/visibility) so a status- or
    // visibility-only change never schedules an autosave cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.title, form.path, form.content, form.contentJson, form.seoTitle, form.seoDesc,
  ]);

  async function handleSave(statusOverride?: PageStatus) {
    if (!clientId) { setError('No client linked to your account. Contact Neu Entity support.'); return; }

    const status = statusOverride ?? form.status;

    setSaving(true);
    setError('');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not authenticated'); setSaving(false); return; }

    const previousStatus = form.status;

    const payload = {
      ...buildContentPayload(form),
      status,
      visibility: form.visibility,
    };

    if (isNew) {
      const { data: newPage, error: err } = await supabase
        .from('pages')
        .insert({ ...payload, client_id: clientId })
        .select()
        .single();

      if (err) { setError(err.message); setSaving(false); return; }

      if (status === 'published') await triggerDeploy(supabase, clientId);

      const action = status === 'published' ? 'published' : 'created';
      await logActivity(supabase, {
        clientId,
        actorId: user.id,
        action,
        entityType: 'page',
        entityId: newPage.id,
        summary: `${ACTIVITY_LABELS[action]} "${payload.title}"`,
      });
      await maybeSnapshotRevision(supabase, user.id, newPage.id, clientId, payload, true);

      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.replace(`/cms/pages/${newPage.id}`);
    } else {
      const { error: err } = await supabase
        .from('pages')
        .update(payload)
        .eq('id', id);

      if (err) { setError(err.message); setSaving(false); return; }

      if (status === 'published') await triggerDeploy(supabase, clientId);

      const action = previousStatus !== status
        ? (status === 'published' ? 'published' : 'updated')
        : 'updated';
      await logActivity(supabase, {
        clientId,
        actorId: user.id,
        action,
        entityType: 'page',
        entityId: id,
        summary: `${ACTIVITY_LABELS[action]} "${payload.title}"`,
      });
      await maybeSnapshotRevision(supabase, user.id, id, clientId, payload, true);

      setForm((f) => ({ ...f, status }));
      // The write above just succeeded, so `status` is now what's actually
      // live in the DB — keep `initialStatus` in sync so a subsequent save
      // in the same session gates on the row's real current state.
      setInitialStatus(status);
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function triggerDeploy(supabase: ReturnType<typeof createClient>, cid: string) {
    const { data: client } = await supabase
      .from('clients')
      .select('deploy_hook')
      .eq('id', cid)
      .single();
    if (client?.deploy_hook) {
      await fetch(client.deploy_hook, { method: 'POST' }).catch(() => null);
    }
  }

  // A plain `editor` (not `canPublish`) can never downgrade a page whose
  // *currently-persisted* status is already published — matching migration
  // 015_publish_rls.sql's `WITH CHECK` gated set for `pages`. Keyed off
  // `initialStatus` (the DB's last-known value), not `form.status`: an
  // editor selecting "Draft" in the dropdown while viewing an
  // already-published page must not unlock either save action below.
  // Never blocks client_admin/ne_admin.
  const isElevatedLocked = !canPublish && initialStatus === 'published';
  const elevatedLockedTitle = isElevatedLocked
    ? 'Only an admin can change the status of an already-published page.'
    : undefined;

  if (loading) {
    return (
      <>
        <Topbar title="Edit Page" subtitle="Loading..." />
        <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={isNew ? 'New Page' : 'Edit Page'}
        subtitle={isNew ? 'Create a new page' : form.title || '(Untitled)'}
      />
      <div className="page-body">
        {/* Breadcrumb + actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Link href="/cms/pages" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to Pages
          </Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isAdmin && isNew && !clientId && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>Select a client in the sidebar first.</div>}
            {error && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>{error}</div>}
            {!isNew && autosaveState === 'error' && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>
                Autosave failed — your last change may not be saved. Use Save Draft to be sure.
              </div>
            )}
            {!isNew && (autosaveState === 'saving' || autosaveState === 'saved') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)' }}>
                {autosaveState === 'saving'
                  ? <><Loader2 size={12} style={{ animation: 'spin .6s linear infinite' }} /> Saving…</>
                  : 'All changes saved'}
              </div>
            )}
            {saved && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#DCFCE7', borderRadius: 'var(--r-sm)' }}>Saved</div>}
            {!isNew && (
              <button className="btn-outline-ne" onClick={() => setHistoryOpen(true)} title="Revision history">
                <History size={14} /> History
              </button>
            )}
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
                "Save Draft" above remains available. Pages have no
                `in_review` state, so there's nothing else to submit into. */}
            {canPublish && (
              <button className="btn-ne" onClick={() => handleSave('published')} disabled={saving}>
                {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Send size={14} />}
                {form.status === 'published' ? 'Update' : 'Publish'}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
          {/* Main editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Title + path */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value, path: f.path || `/${slugify(e.target.value)}` }))}
                placeholder="Page title..."
                style={{ width: '100%', padding: '18px 20px', border: 'none', outline: 'none', fontSize: 22, fontWeight: 700, color: 'var(--fg1)', background: 'transparent' }}
              />
              <div style={{ padding: '0 20px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg3)' }}>
                <span>Path:</span>
                <input
                  value={form.path}
                  onChange={(e) => setForm({ ...form, path: e.target.value })}
                  placeholder="/about"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--ne-blue)', fontFamily: 'monospace' }}
                />
              </div>
            </div>

            {/* Rich text body */}
            <RichTextEditor
              valueJson={form.contentJson}
              fallbackHtml={form.content}
              onChange={(json, html) => setForm((f) => ({ ...f, contentJson: json as Record<string, unknown>, content: html }))}
            />

            {/* SEO */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '18px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg2)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.06em' }}>SEO Settings</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>SEO Title</label>
                  <input
                    value={form.seoTitle || form.title}
                    onChange={(e) => setForm({ ...form, seoTitle: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 12px', fontSize: 13.5, color: 'var(--fg1)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Meta Description</label>
                  <textarea
                    value={form.seoDesc}
                    onChange={(e) => setForm({ ...form, seoDesc: e.target.value })}
                    rows={2}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 12px', fontSize: 13.5, color: 'var(--fg1)', resize: 'none', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <div style={{ fontSize: 11, color: form.seoDesc.length > 160 ? 'var(--ne-danger)' : 'var(--fg3)', marginTop: 4 }}>
                    {form.seoDesc.length}/160 chars
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Publish */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Publish Settings</div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Status</label>
                  {/* Pages have only draft/published — no in_review/scheduled
                      state. Publish now is hidden for `editor` (RLS,
                      migration 015, requires client_admin/ne_admin). If an
                      editor is viewing a page an admin already published, a
                      disabled option keeps the displayed status accurate
                      instead of silently showing "Draft" as selected. */}
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PageStatus })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}>
                    <option value="draft">Draft</option>
                    {canPublish ? (
                      <option value="published">Publish now</option>
                    ) : form.status === 'published' && (
                      <option value="published" disabled>Published</option>
                    )}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Visibility</label>
                  <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as 'public' | 'private' })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}>
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--fg3)', marginTop: 6 }}>
                    {form.visibility === 'public' ? <Globe size={12} /> : <Lock size={12} />}
                    {form.visibility === 'public'
                      ? 'Visible on the public pages API when published.'
                      : 'Hidden from the public pages API even when published.'}
                  </div>
                </div>
                <button
                  className="btn-ne"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => handleSave()}
                  // Disabled whenever `isElevatedLocked` — keyed off
                  // `initialStatus` (the DB's currently-persisted value),
                  // not `form.status`, so selecting "Draft" in the dropdown
                  // above while viewing an already-published page can't
                  // unlock this button — mirrors the post editor's
                  // equivalent guard.
                  disabled={saving || isElevatedLocked}
                  title={elevatedLockedTitle}
                >
                  <Send size={14} />
                  {form.status === 'published' ? 'Update Page' : 'Save as Draft'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!isNew && (
        <RevisionPanel
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          pageId={id}
          onRestore={(row) => applyPageToForm(row)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

/**
 * Right-side slide-in drawer for revision history — same hand-rolled
 * overlay pattern as the post editor's `RevisionPanel`
 * (`src/app/(app)/cms/posts/[id]/page.tsx`), pointed at `entity_type=page`.
 */
function RevisionPanel({
  open, onClose, pageId, onRestore,
}: {
  open: boolean;
  onClose: () => void;
  pageId: string;
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
        const res = await fetch(`/api/cms/revisions?entity_type=page&entity_id=${pageId}`);
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
  }, [open, pageId]);

  async function handleRestore(revisionId: string) {
    if (!window.confirm('Restore this version? The current state will be saved as a revision first, so this can be undone.')) return;

    setRestoringId(revisionId);
    setError('');
    try {
      const res = await fetch('/api/cms/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: 'page', entity_id: pageId, revision_id: revisionId }),
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
