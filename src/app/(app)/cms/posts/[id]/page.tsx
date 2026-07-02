'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Bold, Italic, Underline, Link2, List, ListOrdered,
  Quote, Image as ImageIcon, Code, Heading2, Heading3, Eye, Save, Send, X, Plus, Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { logActivity } from '@/lib/activity';
import MediaPicker from '@/components/MediaPicker';
import type { MediaItem } from '@/app/api/media/route';

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  published: 'Published',
  archived: 'Archived',
};

const EMPTY_FORM = {
  title: '', slug: '', excerpt: '', content: '',
  category: 'Worship', status: 'draft',
  featuredImg: '', tags: [] as string[],
  seoTitle: '', seoDesc: '',
};

export default function PostEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew  = id === 'new';
  const router = useRouter();

  const [form,        setForm]      = useState({ ...EMPTY_FORM });
  const [tagInput,    setTagInput]  = useState('');
  const [loading,     setLoading]   = useState(!isNew);
  const [saving,      setSaving]    = useState(false);
  const [saved,       setSaved]     = useState(false);
  const [error,       setError]     = useState('');
  const [clientId,    setClientId]  = useState<string | null>(null);
  const [isAdmin,     setIsAdmin]   = useState(false);
  const [preview,     setPreview]   = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const { selectedClientId } = useSelectedClient();
  const editorRef = useRef<HTMLDivElement>(null);

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
          setForm({
            title:      post.title       ?? '',
            slug:       post.slug        ?? '',
            excerpt:    post.excerpt     ?? '',
            content:    post.content     ?? '',
            category:   post.category    ?? 'Worship',
            status:     post.status      ?? 'draft',
            featuredImg:post.cover_url   ?? '',
            tags:       post.tags        ?? [],
            seoTitle:   post.seo_title   ?? '',
            seoDesc:    post.seo_description ?? '',
          });
        }
        setLoading(false);
      }
    }
    load();
  }, [id, isNew, selectedClientId]);

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const syncEditor = () => {
    if (editorRef.current) {
      setForm((f) => ({ ...f, content: editorRef.current?.innerHTML ?? '' }));
    }
  };
  const applyFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditor();
  };
  const addLink = () => {
    const url = window.prompt('Paste the link URL');
    if (url) applyFormat('createLink', url);
  };
  const addInlineImage = () => {
    const url = window.prompt('Paste the image URL');
    if (url) applyFormat('insertImage', url);
  };
  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    setTagInput('');
  };
  async function handleSave(statusOverride?: string) {
    if (!clientId) { setError('No client linked to your account. Contact Neu Entity support.'); return; }
    setSaving(true);
    setError('');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not authenticated'); setSaving(false); return; }

    const previousStatus = form.status;
    const status     = statusOverride ?? form.status;
    const published  = status === 'published' ? new Date().toISOString() : null;

    const payload = {
      title:           form.title || '(Untitled)',
      slug:            form.slug || slugify(form.title) || 'untitled-post',
      excerpt:         form.excerpt,
      content:         form.content,
      category:        form.category,
      tags:            form.tags,
      status,
      cover_url:       form.featuredImg || null,
      seo_title:       form.seoTitle || null,
      seo_description: form.seoDesc  || null,
      ...(published ? { published_at: published } : {}),
    };

    if (isNew) {
      const { data: newPost, error: err } = await supabase
        .from('posts')
        .insert({ ...payload, client_id: clientId, author_id: user.id })
        .select()
        .single();

      if (err) { setError(err.message); setSaving(false); return; }

      // Trigger deploy hook if publishing
      if (status === 'published') await triggerDeploy(supabase, clientId);

      const action = status === 'published' ? 'published' : 'created';
      await logActivity(supabase, {
        clientId,
        actorId: user.id,
        action,
        entityType: 'post',
        entityId: newPost.id,
        summary: `${ACTIVITY_LABELS[action]} "${payload.title}"`,
      });

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
          ? (status === 'published' ? 'published' : status === 'archived' ? 'archived' : 'updated')
          : 'updated';
      await logActivity(supabase, {
        clientId,
        actorId: user.id,
        action,
        entityType: 'post',
        entityId: id,
        summary: `${ACTIVITY_LABELS[action]} "${payload.title}"`,
      });

      setForm((f) => ({ ...f, status }));
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
            {saved && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#DCFCE7', borderRadius: 'var(--r-sm)' }}>Saved</div>}
            <button className="btn-outline-ne" onClick={() => handleSave('draft')} disabled={saving}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
              Save Draft
            </button>
            <button className="btn-ne" onClick={() => handleSave('published')} disabled={saving}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Send size={14} />}
              {form.status === 'published' ? 'Update' : 'Publish'}
            </button>
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

            {/* Rich text editor */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div className="editor-toolbar">
                {[{ id: 'formatBlock', value: 'h2', Icon: Heading2 }, { id: 'formatBlock', value: 'h3', Icon: Heading3 }].map(({ id, value, Icon }) => (
                  <button key={value} className="toolbar-btn" onClick={() => applyFormat(id, value)} title={value.toUpperCase()}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="toolbar-sep" />
                {[{ id: 'bold', Icon: Bold }, { id: 'italic', Icon: Italic }, { id: 'underline', Icon: Underline }].map(({ id, Icon }) => (
                  <button key={id} className="toolbar-btn" onClick={() => applyFormat(id)} title={id}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="toolbar-sep" />
                {[
                  { id: 'insertUnorderedList', Icon: List },
                  { id: 'insertOrderedList', Icon: ListOrdered },
                  { id: 'formatBlock', value: 'blockquote', Icon: Quote },
                  { id: 'formatBlock', value: 'pre', Icon: Code },
                ].map(({ id, value, Icon }) => (
                  <button key={value ?? id} className="toolbar-btn" onClick={() => applyFormat(id, value)} title={value ?? id}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="toolbar-sep" />
                <button className="toolbar-btn" onClick={addLink} title="Add link"><Link2 size={15} /></button>
                <button className="toolbar-btn" onClick={addInlineImage} title="Insert image"><ImageIcon size={15} /></button>
                <div style={{ marginLeft: 'auto' }}>
                  <button className={`toolbar-btn${preview ? ' active' : ''}`} style={{ fontSize: 11, fontWeight: 700 }} onClick={() => setPreview((p) => !p)}>
                    <Eye size={14} /> {preview ? 'Edit' : 'Preview'}
                  </button>
                </div>
              </div>
              {preview ? (
                <div
                  dangerouslySetInnerHTML={{ __html: form.content || '<p style="color: var(--fg3)">Nothing to preview yet.</p>' }}
                  style={{ minHeight: 420, padding: '20px 24px', fontSize: 14.5, lineHeight: 1.75, color: 'var(--fg1)' }}
                />
              ) : (
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  dangerouslySetInnerHTML={{ __html: form.content }}
                  onInput={syncEditor}
                  style={{ minHeight: 420, padding: '20px 24px', outline: 'none', fontSize: 14.5, lineHeight: 1.75, color: 'var(--fg1)' }}
                />
              )}
            </div>

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
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Category</label>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }} />
                </div>
                <button className="btn-ne" style={{ width: '100%', justifyContent: 'center' }} onClick={() => handleSave('published')} disabled={saving}>
                  <Send size={14} /> {form.status === 'published' ? 'Update Post' : 'Publish Post'}
                </button>
                <button className="btn-outline-ne" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }} onClick={() => handleSave('draft')} disabled={saving}>
                  <Save size={14} /> Save as Draft
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
