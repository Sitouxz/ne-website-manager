'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useEffect, useState, use, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Image as ImageIcon, Save, Send, X, Plus, Loader2, Eye, History,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { logActivity } from '@/lib/activity';
import MediaPicker from '@/components/MediaPicker';
import type { MediaItem } from '@/app/api/media/route';
import RichTextEditor from '@/components/editor/RichTextEditor';
import type { PostStatus } from '@/lib/supabase/types';

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  published: 'Published',
  archived: 'Archived',
  // Not one of the four DB-level activity actions the plan originally
  // documented (created/updated/published/archived) — that comment is
  // non-enforced documentation, not a CHECK constraint on `activity_log`, so
  // using a fifth, more descriptive action string here for the
  // draft->scheduled transition gives a clearer audit trail than lumping it
  // in under 'updated'.
  scheduled: 'Scheduled',
};

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  contentJson: Record<string, unknown> | null;
  category: string;
  status: PostStatus;
  featuredImg: string;
  tags: string[];
  seoTitle: string;
  seoDesc: string;
  /** `datetime-local` input value (local time, no timezone suffix); empty when not scheduled. */
  scheduledAt: string;
}

const EMPTY_FORM: FormState = {
  title: '', slug: '', excerpt: '', content: '', contentJson: null,
  category: 'Worship', status: 'draft',
  featuredImg: '', tags: [],
  seoTitle: '', seoDesc: '',
  scheduledAt: '',
};

const REVISION_SNAPSHOT_INTERVAL_MS = 60_000;
const PREVIEW_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Converts an ISO timestamp to the local-time value a `datetime-local` input expects. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface RevisionListItem {
  id: string;
  created_at: string;
  author_id: string | null;
  author_name?: string;
  snapshot: Record<string, unknown>;
}

export default function PostEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew  = id === 'new';
  const router = useRouter();

  const [form,        setForm]      = useState<FormState>({ ...EMPTY_FORM });
  const [tagInput,    setTagInput]  = useState('');
  const [loading,     setLoading]   = useState(!isNew);
  const [saving,      setSaving]    = useState(false);
  const [saved,       setSaved]     = useState(false);
  const [error,       setError]     = useState('');
  const [clientId,    setClientId]  = useState<string | null>(null);
  const [isAdmin,     setIsAdmin]   = useState(false);
  // Whether this user's role is allowed to publish/schedule a post at all
  // (`client_admin`/`ne_admin`, per migration 015_publish_rls.sql's
  // `WITH CHECK` on `posts`). This is a UX nicety only — it hides/disables
  // the Schedule/Publish controls so a plain `editor` never submits a save
  // RLS would reject anyway; the actual security boundary is the database
  // policy itself, same convention as the role-gating in Tasks 4.2/5.3.
  const [canPublish, setCanPublish] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { selectedClientId } = useSelectedClient();

  // Guards against autosave firing in response to *this component* setting
  // `form` itself (initial load from the DB, or a revision restore) rather
  // than a genuine user edit. See the `useEffect` below.
  const skipNextAutosaveRef = useRef(true);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRevisionSnapshotAtRef = useRef(0);

  function applyPostToForm(post: Record<string, unknown>) {
    skipNextAutosaveRef.current = true;
    setForm({
      title:       (post.title as string) ?? '',
      slug:        (post.slug as string) ?? '',
      excerpt:     (post.excerpt as string) ?? '',
      content:     (post.content as string) ?? '',
      contentJson: (post.content_json as Record<string, unknown> | null) ?? null,
      category:    (post.category as string) ?? 'Worship',
      status:      (post.status as PostStatus) ?? 'draft',
      featuredImg: (post.cover_url as string) ?? '',
      tags:        (post.tags as string[]) ?? [],
      seoTitle:    (post.seo_title as string) ?? '',
      seoDesc:     (post.seo_description as string) ?? '',
      scheduledAt: post.scheduled_at ? toDatetimeLocalValue(post.scheduled_at as string) : '',
    });
  }

  // Load existing post + client_id
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
        const { data: post } = await supabase
          .from('posts')
          .select('*')
          .eq('id', id)
          .single();

        if (post) {
          if (admin) setClientId(post.client_id);
          applyPostToForm(post);
        }
        setLoading(false);
      }
    }
    load();
  }, [id, isNew, selectedClientId]);

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    setTagInput('');
  };

  /**
   * The content-only fields every save path (manual, autosave, restore)
   * writes — never status/published_at/scheduled_at. Depends on nothing but
   * its `f` argument: `slugify` is a pure, stateless helper closed over here,
   * so its identity changing every render isn't a real dependency.
   */
  const buildContentPayload = useCallback((f: FormState) => ({
    title:           f.title || '(Untitled)',
    slug:            f.slug || slugify(f.title) || 'untitled-post',
    excerpt:         f.excerpt,
    content:         f.content,
    content_json:    f.contentJson,
    category:        f.category,
    tags:            f.tags,
    cover_url:       f.featuredImg || null,
    seo_title:       f.seoTitle || null,
    seo_description: f.seoDesc  || null,
  }), []);

  /**
   * Writes a `revisions` row, throttled to at most once per
   * `REVISION_SNAPSHOT_INTERVAL_MS` — except when `force` is set, which
   * every explicit user action (manual save, status change, publish,
   * restore) always passes, so an explicit action is never silently
   * un-snapshotted by the throttle. Tracked in a ref (not state) so the
   * throttle check itself never triggers a re-render.
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
      entity_type: 'post',
      entity_id: entityId,
      snapshot,
      author_id: authorId,
    });
  }

  // Autosave: debounced 2s after the last content edit, for any existing
  // post (not `isNew` — there's no row to write to yet). Runs regardless of
  // status (including `published`, per the brief: an in-progress edit to a
  // published post shouldn't be lost to a stray tab-close before the next
  // manual save) but the payload from `buildContentPayload` never includes
  // status/published_at/scheduled_at, so autosave can never flip those.
  useEffect(() => {
    if (isNew || loading || !clientId) return;
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return; }

    // Hide any stale "All changes saved" (or "Autosave failed") from a
    // previous cycle the instant a new edit comes in — it shouldn't keep
    // claiming "saved" for the 2s window before the next debounced write
    // actually lands, and a fresh edit is the user's cue that we're about to
    // try again (not an automatic retry — it only fires because they typed).
    setAutosaveState('idle');

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      setAutosaveState('saving');
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAutosaveState('error'); return; }

      const payload = buildContentPayload(form);
      const { error: err } = await supabase.from('posts').update(payload).eq('id', id);
      if (err) { setAutosaveState('error'); return; }

      setAutosaveState('saved');
      await maybeSnapshotRevision(supabase, user.id, id, clientId, payload, false);
    }, 2000);

    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
    // Deliberately depends on each content field individually (not `form` as
    // a whole, and excluding status/scheduledAt) so a status- or
    // schedule-only change never schedules an autosave cycle — autosave
    // must never silently change what a manual save or an explicit status
    // transition controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.title, form.slug, form.excerpt, form.content, form.contentJson,
    form.category, form.tags, form.featuredImg, form.seoTitle, form.seoDesc,
  ]);

  async function handleSave(statusOverride?: PostStatus) {
    if (!clientId) { setError('No client linked to your account. Contact Neu Entity support.'); return; }

    const status = statusOverride ?? form.status;
    if (status === 'scheduled' && !form.scheduledAt) {
      setError('Pick a date and time to schedule this post.');
      return;
    }

    setSaving(true);
    setError('');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not authenticated'); setSaving(false); return; }

    const previousStatus = form.status;
    const published = status === 'published' ? new Date().toISOString() : null;
    const scheduledAtIso = status === 'scheduled' ? new Date(form.scheduledAt).toISOString() : null;

    const payload = {
      ...buildContentPayload(form),
      status,
      scheduled_at: scheduledAtIso,
      ...(published ? { published_at: published } : {}),
    };

    if (isNew) {
      const { data: newPost, error: err } = await supabase
        .from('posts')
        .insert({ ...payload, client_id: clientId, author_id: user.id })
        .select()
        .single();

      if (err) { setError(err.message); setSaving(false); return; }

      if (status === 'published') await triggerDeploy(supabase, clientId);

      const action = status === 'published' ? 'published' : status === 'scheduled' ? 'scheduled' : 'created';
      await logActivity(supabase, {
        clientId,
        actorId: user.id,
        action,
        entityType: 'post',
        entityId: newPost.id,
        summary: `${ACTIVITY_LABELS[action]} "${payload.title}"`,
      });
      await maybeSnapshotRevision(supabase, user.id, newPost.id, clientId, payload, true);

      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.replace(`/cms/posts/${newPost.id}`);
    } else {
      const { error: err } = await supabase
        .from('posts')
        .update(payload)
        .eq('id', id);

      if (err) { setError(err.message); setSaving(false); return; }

      if (status === 'published') await triggerDeploy(supabase, clientId);

      const action =
        previousStatus !== status
          ? (status === 'published' ? 'published'
            : status === 'archived' ? 'archived'
            : status === 'scheduled' ? 'scheduled'
            : 'updated')
          : 'updated';
      await logActivity(supabase, {
        clientId,
        actorId: user.id,
        action,
        entityType: 'post',
        entityId: id,
        summary: `${ACTIVITY_LABELS[action]} "${payload.title}"`,
      });
      await maybeSnapshotRevision(supabase, user.id, id, clientId, payload, true);

      setForm((f) => ({ ...f, status, scheduledAt: status === 'scheduled' ? f.scheduledAt : '' }));
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

  async function handlePreview() {
    if (isNew || !clientId) return;
    setPreviewError('');
    setPreviewLoading(true);

    const supabase = createClient();
    const { data: client } = await supabase
      .from('clients')
      .select('website_url')
      .eq('id', clientId)
      .single();

    const websiteUrl = client?.website_url;
    if (!websiteUrl) {
      setPreviewError('No website URL configured for this client — set one in Settings.');
      setPreviewLoading(false);
      return;
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + PREVIEW_TOKEN_TTL_MS).toISOString();
    const { error: err } = await supabase.from('preview_tokens').insert({
      client_id: clientId,
      entity_type: 'post',
      entity_id: id,
      token,
      expires_at: expiresAt,
    });

    setPreviewLoading(false);
    if (err) { setPreviewError(err.message); return; }

    window.open(`${websiteUrl.replace(/\/$/, '')}/api/preview?token=${token}`, '_blank');
  }

  if (loading) {
    return (
      <>
        <Topbar title="Edit Post" subtitle="Loading..." />
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
        title={isNew ? 'New Post' : 'Edit Post'}
        subtitle={isNew ? 'Create a new blog post' : form.title || '(Untitled)'}
      />
      <div className="page-body">
        {/* Breadcrumb + actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Link href="/cms/posts" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to Posts
          </Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isAdmin && isNew && !clientId && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>Select a client in the sidebar first.</div>}
            {error && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>{error}</div>}
            {previewError && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>{previewError}</div>}
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
            {!isNew && (
              <button className="btn-outline-ne" onClick={handlePreview} disabled={previewLoading} title="Preview on live site">
                {previewLoading ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Eye size={14} />}
                Preview
              </button>
            )}
            <button className="btn-outline-ne" onClick={() => handleSave('draft')} disabled={saving}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
              Save Draft
            </button>
            {/* Publish shortcut: hidden entirely for `editor` — RLS
                (migration 015) rejects any save that leaves `status =
                'published'` unless the caller is client_admin/ne_admin, so
                showing this button to an editor would only produce a
                confusing RLS-denial error. "Save Draft" above and the
                sidebar's status-aware action button below remain available. */}
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
            {/* Title + slug */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value, slug: slugify(e.target.value) })}
                placeholder="Post title..."
                style={{ width: '100%', padding: '18px 20px', border: 'none', outline: 'none', fontSize: 22, fontWeight: 700, color: 'var(--fg1)', background: 'transparent' }}
              />
              <div style={{ padding: '0 20px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg3)' }}>
                <span>Slug:</span>
                <input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
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

            {/* Excerpt */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '18px 20px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--fg2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>Excerpt</label>
              <textarea
                value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                placeholder="Short description shown in post listings..."
                rows={3}
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px', fontSize: 13.5, color: 'var(--fg1)', resize: 'vertical', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>

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
                    value={form.seoDesc || form.excerpt}
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
                  {/* Draft/In review are always selectable — moving a post
                      into `in_review` is exactly "Submit for Review" (the
                      sidebar action button below relabels itself to that
                      when this option is picked). Schedule/Publish now are
                      hidden for `editor` — RLS (migration 015) requires
                      client_admin/ne_admin for those; showing them would let
                      an editor pick an option that then fails to save. If an
                      editor is viewing a post an admin already scheduled or
                      published, a disabled option preserves an accurate
                      (non-editable) status display instead of silently
                      showing "Draft" as selected. */}
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PostStatus })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}>
                    <option value="draft">Draft</option>
                    <option value="in_review">In review</option>
                    {canPublish ? (
                      <>
                        <option value="scheduled">Schedule</option>
                        <option value="published">Publish now</option>
                      </>
                    ) : (form.status === 'scheduled' || form.status === 'published') && (
                      <option value={form.status} disabled>
                        {form.status === 'scheduled' ? 'Scheduled' : 'Published'}
                      </option>
                    )}
                  </select>
                </div>
                {form.status === 'scheduled' && (
                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Publish at</label>
                    <input
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                      style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}
                    />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Category</label>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }} />
                </div>
                <button
                  className="btn-ne"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => handleSave()}
                  // Disabled (not just hidden) when the post's *current*
                  // status is already an elevated one (scheduled/published)
                  // an editor can't touch at all per RLS — the status select
                  // above can't set these for an editor, but a post an admin
                  // already scheduled/published keeps that value in `form`,
                  // and re-saving it unchanged would still fail the same
                  // `WITH CHECK`.
                  disabled={saving || (!canPublish && (form.status === 'scheduled' || form.status === 'published'))}
                >
                  <Send size={14} />
                  {form.status === 'scheduled' ? 'Schedule Post'
                    : form.status === 'in_review' ? 'Submit for Review'
                    : form.status === 'published' ? 'Update Post'
                    : 'Save as Draft'}
                </button>
              </div>
            </div>

            {/* Featured image */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Featured Image</div>
              <div style={{ padding: '14px 16px' }}>
                {form.featuredImg ? (
                  <div style={{ position: 'relative' }}>
                    <img src={form.featuredImg} alt="" style={{ width: '100%', borderRadius: 'var(--r-sm)', objectFit: 'cover', height: 140 }} />
                    <button onClick={() => setShowImagePicker(true)}
                      style={{ position: 'absolute', bottom: 6, left: 6, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 'var(--r-sm)', padding: '4px 10px', cursor: 'pointer', color: '#fff', fontSize: 11, fontWeight: 600 }}>
                      Change
                    </button>
                    <button onClick={() => setForm({ ...form, featuredImg: '' })}
                      style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', color: '#fff', display: 'grid', placeItems: 'center' }}>
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setShowImagePicker(true)} style={{ width: '100%', border: '2px dashed var(--border)', borderRadius: 'var(--r-sm)', padding: '28px 16px', textAlign: 'center', cursor: 'pointer', background: 'transparent' }}>
                    <ImageIcon size={22} color="var(--fg3)" style={{ margin: '0 auto 8px' }} />
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 4 }}>Add Featured Image</div>
                    <div style={{ fontSize: 11, color: 'var(--fg3)' }}>Choose from the media library</div>
                  </button>
                )}
              </div>
            </div>

            {/* Tags */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Tags</div>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {form.tags.map((t) => (
                    <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, background: 'var(--surface-3)', color: 'var(--fg2)', padding: '3px 8px', borderRadius: 99 }}>
                      {t}
                      <button onClick={() => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 0, display: 'flex' }}>
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="Add tag..."
                    style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 10px', fontSize: 12.5, outline: 'none' }}
                  />
                  <button onClick={addTag} style={{ background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MediaPicker
        open={showImagePicker}
        onOpenChange={setShowImagePicker}
        accept="image"
        onSelect={(item: MediaItem) => setForm((f) => ({ ...f, featuredImg: item.url }))}
      />

      {!isNew && (
        <RevisionPanel
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          postId={id}
          onRestore={(row) => applyPostToForm(row)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

/**
 * Right-side slide-in drawer for revision history — the hand-rolled
 * `position: fixed` overlay + panel pattern already established by
 * `MediaPicker.tsx` and the Settings API Keys dialog, anchored to the right
 * edge instead of centered. Deliberately not the shadcn `Sheet` in
 * `components/ui/sheet.tsx`, which (like `components/ui/dialog.tsx`) isn't
 * used anywhere else in this codebase.
 */
function RevisionPanel({
  open, onClose, postId, onRestore,
}: {
  open: boolean;
  onClose: () => void;
  postId: string;
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
        const res = await fetch(`/api/cms/revisions?entity_type=post&entity_id=${postId}`);
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
  }, [open, postId]);

  async function handleRestore(revisionId: string) {
    if (!window.confirm('Restore this version? The current state will be saved as a revision first, so this can be undone.')) return;

    setRestoringId(revisionId);
    setError('');
    try {
      const res = await fetch('/api/cms/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: 'post', entity_id: postId, revision_id: revisionId }),
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
