'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Filter, MoreHorizontal, Edit, Trash2, Loader2, FileText, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { useConfirm } from '@/components/ConfirmDialog';
import { firePublishNotify, computeLivePath } from '@/lib/publish-client';
import { errorMessage } from '@/lib/errors';
import { statusDescription, statusLabel } from '@/lib/content-status';
import { EmptyState, NoResultsState } from '@/components/EmptyState';
import { BulkActionBar, SelectCell } from '@/components/builder/BulkActionBar';
import { useBulkSelection } from '@/lib/hooks/useBulkSelection';
import type { Post } from '@/lib/supabase/types';
import { copyTitle, nextCopySlug } from '@/lib/duplicate';
import { TRASH_RETENTION_DAYS, moveToTrash, restoreFromTrash } from '@/lib/trash';
import { statusChangeEvent } from '@/lib/publish-events';

const STATUSES = ['All', 'published', 'scheduled', 'in_review', 'draft', 'archived'];

export default function PostsPage() {
  const [posts,    setPosts]    = useState<Post[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [cat,      setCat]      = useState('All');
  const [status,   setStatus]   = useState('All');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  // Publishing a post is restricted to client_admin/ne_admin by migration 015.
  // RLS is the real gate; this only keeps a plain editor from firing a screenful
  // of writes the database will reject one by one.
  const [canPublish, setCanPublish] = useState(false);
  const { selectedClientId } = useSelectedClient();
  const router = useRouter();
  const confirm = useConfirm();

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });
    if (selectedClientId) query = query.eq('client_id', selectedClientId);
    const { data } = await query;
    setPosts(data ?? []);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setCanPublish(profile?.role === 'ne_admin' || profile?.role === 'client_admin');
    }

    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchPosts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchPosts]);

  async function handleDelete(post: Post) {
    const title = post.title || '(Untitled)';
    const isLive = post.status === 'published';

    const ok = await confirm({
      title: `Move "${title}" to the trash?`,
      body: `You can restore it from the trash for ${TRASH_RETENTION_DAYS} days.`,
      // Naming the visitor-facing effect is the whole point: "cannot be
      // undone" tells someone the mechanism, not what their readers will see.
      consequences: isLive
        ? [
            'This post is published, so it will disappear from your website.',
            'Anyone who has the link, or finds it in Google, will see a "page not found" error.',
          ]
        : ['This post is not published, so nothing on your website will change.'],
      confirmLabel: 'Move to trash',
    });
    if (!ok) return;

    setDeleting(post.id);
    const supabase = createClient();
    const { trashId, error } = await moveToTrash(supabase, 'post', post.id);
    setDeleting(null);
    setOpenMenu(null);

    if (error) {
      toast.error(error);
      return;
    }
    // Deleting live content is a change to the client's website, but used to
    // fire no webhook at all — the post stayed cached and visible after it had
    // been removed from the CMS. Only fired for content that was actually
    // published; deleting a draft changes nothing a visitor can see.
    if (isLive && post.client_id) {
      firePublishNotify({
        clientId: post.client_id,
        event: 'content.deleted',
        entityType: 'post',
        entityId: post.id,
        slug: post.slug,
        // No `blogPath` here: this list never loads the client row, and a
        // client whose blog is routed elsewhere translates the default at
        // its own revalidate handler. The editor, which does have the row,
        // passes the real value.
        path: computeLivePath('post', { slug: post.slug }),
      });
    }

    setPosts((prev) => prev.filter((p) => p.id !== post.id));
    toast.success(`"${title}" moved to the trash.`, trashId ? {
      action: { label: 'Undo', onClick: () => { void undoTrash(trashId, post); } },
    } : undefined);
  }

  async function undoTrash(trashId: string, post: Post) {
    const { row, error } = await restoreFromTrash(createClient(), trashId, 'post');
    if (error || !row) {
      toast.error(error ?? 'Could not restore the post.');
      return;
    }
    setPosts((prev) => [row as unknown as Post, ...prev]);
    // Restoring live content puts it back on the website, so the site needs
    // the same nudge a publish gives it.
    if (post.status === 'published' && post.client_id) {
      firePublishNotify({
        clientId: post.client_id,
        event: 'content.published',
        entityType: 'post',
        entityId: post.id,
        slug: post.slug,
        path: computeLivePath('post', { slug: post.slug }),
      });
    }
    toast.success(`"${post.title || '(Untitled)'}" restored.`);
  }

  /**
   * Copies a post as a draft and opens it.
   *
   * Always a draft, whatever the original was: a duplicate is a starting
   * point, and silently publishing a second copy of a live article — at the
   * same moment, under a near-identical slug — is the opposite of what
   * "duplicate" means to anyone clicking it.
   *
   * The slug gets a `-copy-N` suffix, N being one past the highest existing
   * copy, mirroring the entries list. `posts.slug` is unique per client, so
   * guessing a colliding suffix would fail the insert outright.
   */
  async function handleDuplicate(post: Post) {
    setDuplicating(post.id);
    setOpenMenu(null);


    const supabase = createClient();
    const { data: created, error } = await supabase
      .from('posts')
      .insert({
        client_id: post.client_id,
        title: copyTitle(post.title),
        slug: nextCopySlug(post.slug, posts.map((current) => current.slug)),
        excerpt: post.excerpt,
        content: post.content,
        content_json: post.content_json,
        category: post.category,
        tags: post.tags,
        cover_url: post.cover_url,
        cover_alt: post.cover_alt,
        seo_title: post.seo_title,
        seo_description: post.seo_description,
        og_image_url: post.og_image_url,
        // Canonical is deliberately not copied: a copy pointing its canonical
        // at the original would quietly keep the new content out of search.
        noindex: post.noindex,
        status: 'draft',
      })
      .select()
      .single();
    setDuplicating(null);

    if (error) {
      toast.error(errorMessage(error, { entity: 'post', action: 'save' }));
      return;
    }
    toast.success(`Duplicated "${post.title || '(Untitled)'}" as a draft.`);
    router.push(`/cms/posts/${created.id}`);
  }

  /**
   * Publishes or unpublishes every selected post.
   *
   * Unlike collection entries there is no schema to validate against, but a
   * post with no title or no body is still not something to put on a website
   * unannounced — those are reported as skipped rather than published, using
   * the same rule the publish preflight applies in the editor.
   *
   * Unpublishing skips every check: taking something down must never be
   * blocked by the content being incomplete.
   */
  /**
   * Narrower than `PostStatus` on purpose. `scheduled` needs a
   * `scheduled_at`, and `in_review` is a per-author workflow step — passing
   * either here would write a post into a state the rest of the app assumes
   * is impossible (a scheduled post with no date never publishes, and the
   * cron would never pick it up).
   */
  async function bulkSetStatus(target: 'published' | 'draft' | 'archived') {
    const chosen = posts.filter((p) => selection.selectedVisibleIds.includes(p.id));
    if (chosen.length === 0) return;

    const skipped: string[] = [];
    const eligible = target === 'published'
      ? chosen.filter((p) => {
          const usable = p.title.trim() !== '' && p.content.replace(/<[^>]*>/g, '').trim() !== '';
          if (!usable) skipped.push(p.title || '(Untitled)');
          return usable;
        })
      : chosen;

    if (eligible.length === 0) {
      toast.error(`Nothing could be published — ${skipped.join(', ')} ${skipped.length === 1 ? 'has' : 'have'} no title or no content yet.`);
      return;
    }

    setBulkBusy(true);
    const supabase = createClient();
    const publishedAt = new Date().toISOString();

    const results = await Promise.all(eligible.map((p) => supabase
      .from('posts')
      .update({
        status: target,
        // Only stamp on the transition INTO published, so re-publishing an old
        // post does not re-date it and reshuffle the client's blog ordering.
        ...(target === 'published' && p.status !== 'published' ? { published_at: publishedAt } : {}),
      })
      .eq('id', p.id)));

    const succeeded = eligible.filter((_, i) => !results[i].error);
    const failed = eligible.length - succeeded.length;

    // Taking a post down only notifies if it was actually up — moving forty
    // drafts to draft changes nothing a reader can see, and firing forty
    // `content.deleted` events would rebuild the client's site for nothing.
    for (const post of succeeded) {
      if (!post.client_id) continue;
      const event = statusChangeEvent(post.status === 'published', target === 'published');
      if (!event) continue;

      firePublishNotify({
        clientId: post.client_id,
        event,
        entityType: 'post',
        entityId: post.id,
        slug: post.slug,
        path: computeLivePath('post', { slug: post.slug }),
      });
    }

    setPosts((prev) => prev.map((p) => (
      succeeded.some((x) => x.id === p.id) ? { ...p, status: target } : p
    )));
    selection.clear();
    setBulkBusy(false);

    const verb = target === 'published' ? 'published'
      : target === 'archived' ? 'archived'
      : 'moved to draft';
    const parts = [`${succeeded.length} ${succeeded.length === 1 ? 'post' : 'posts'} ${verb}`];
    if (skipped.length > 0) parts.push(`${skipped.length} skipped as incomplete: ${skipped.join(', ')}`);
    if (failed > 0) parts.push(`${failed} failed`);

    if (failed > 0 || skipped.length > 0) toast.warning(parts.join('. ') + '.');
    else toast.success(parts[0] + '.');
  }

  async function bulkDelete() {
    const chosen = posts.filter((p) => selection.selectedVisibleIds.includes(p.id));
    if (chosen.length === 0) return;
    const liveCount = chosen.filter((p) => p.status === 'published').length;

    const ok = await confirm({
      title: `Move ${chosen.length} ${chosen.length === 1 ? 'post' : 'posts'} to the trash?`,
      body: `You can restore them from the trash for ${TRASH_RETENTION_DAYS} days.`,
      consequences: liveCount > 0
        ? [
            `${liveCount} of them ${liveCount === 1 ? 'is' : 'are'} published, so ${liveCount === 1 ? 'it' : 'they'} will disappear from your website.`,
            'Anyone who has a link, or finds one in Google, will see a "page not found" error.',
          ]
        : ['None of them are published, so nothing on your website will change.'],
      confirmLabel: 'Move to trash',
    });
    if (!ok) return;

    setBulkBusy(true);
    const supabase = createClient();
    const results = await Promise.all(chosen.map((p) => moveToTrash(supabase, 'post', p.id)));
    const deleted = chosen.filter((_, i) => !results[i].error);
    const firstError = results.find((r) => r.error)?.error;
    const failed = chosen.length - deleted.length;

    // One notification per deleted post, and only for ones that were live —
    // deleting a draft changes nothing a visitor can see.
    for (const post of deleted) {
      if (post.status !== 'published' || !post.client_id) continue;
      firePublishNotify({
        clientId: post.client_id,
        event: 'content.deleted',
        entityType: 'post',
        entityId: post.id,
        slug: post.slug,
        path: computeLivePath('post', { slug: post.slug }),
      });
    }

    setPosts((prev) => prev.filter((p) => !deleted.some((d) => d.id === p.id)));
    selection.clear();
    setBulkBusy(false);

    if (failed > 0) toast.warning(`${deleted.length} moved to the trash, ${failed} could not be. ${firstError ?? ''}`.trim());
    else toast.success(`${deleted.length} ${deleted.length === 1 ? 'post' : 'posts'} moved to the trash.`);
  }

  const filtered = posts.filter((p) =>
    (cat    === 'All' || p.category === cat) &&
    (status === 'All' || p.status   === status) &&
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  const selection = useBulkSelection(filtered.map((p) => p.id));

  const categories = useMemo(() => {
    const values = new Set(posts.map((post) => post.category).filter(Boolean));
    return ['All', ...[...values].sort((a, b) => a.localeCompare(b))];
  }, [posts]);

  return (
    <>
      <Topbar title="Blog Posts" subtitle={`${posts.length} posts total`} />
      <div className="page-body">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: status === s ? 'var(--ne-blue)' : 'var(--surface)',
                color:      status === s ? '#fff'          : 'var(--fg2)',
                boxShadow: 'var(--shadow-sm)',
              }}>
                {s === 'All' ? 'All posts' : statusLabel(s)}
              </button>
            ))}
          </div>
          <Link href="/cms/posts/new" className="btn-ne">
            <Plus size={15} /> New Post
          </Link>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>

          {/* Search + filter */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 12px' }}>
              <Search size={14} color="var(--fg3)" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search posts..."
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--fg1)', width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Filter size={13} color="var(--fg3)" />
              <select value={cat} onChange={(e) => setCat(e.target.value)}
                style={{ fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', color: 'var(--fg1)', background: 'var(--surface)', cursor: 'pointer' }}>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <BulkActionBar
            count={selection.count}
            busy={bulkBusy}
            onClear={selection.clear}
            onDelete={bulkDelete}
            deleteLabel="Move to trash"
          >
            {canPublish && (
              <>
                <button className="btn-outline-ne" onClick={() => bulkSetStatus('published')} disabled={bulkBusy}>
                  Publish
                </button>
                <button className="btn-outline-ne" onClick={() => bulkSetStatus('draft')} disabled={bulkBusy}>
                  Move to draft
                </button>
                {/* Gated with the other two: archiving a published post is a
                    de-facto unpublish, which migration 016's trigger blocks
                    for a non-admin regardless of what this button offers. */}
                <button className="btn-outline-ne" onClick={() => bulkSetStatus('archived')} disabled={bulkBusy}>
                  Archive
                </button>
              </>
            )}
          </BulkActionBar>

          {/* Table */}
          <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 40, paddingLeft: 16 }}>
                  <SelectCell
                    checked={selection.allVisibleSelected}
                    onToggle={selection.toggleAllVisible}
                    label={selection.allVisibleSelected ? 'Clear selection' : 'Select all shown posts'}
                  />
                </th>
                <th>Title</th>
                <th>Category</th>
                <th>Status</th>
                <th>Date</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="table-placeholder">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Loader2 size={16} className="spin" /> Loading posts...
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 0 }}>
                    {posts.length === 0 ? (
                      <EmptyState
                        icon={FileText}
                        title="No blog posts yet"
                        body="Posts you write here appear on your website's blog, in the order you publish them."
                        actionLabel="Write your first post"
                        actionHref="/cms/posts/new"
                      />
                    ) : (
                      <NoResultsState
                        noun="posts"
                        onClear={() => { setSearch(''); setCat('All'); setStatus('All'); }}
                      />
                    )}
                  </td>
                </tr>
              ) : filtered.map((p) => (
                <tr key={p.id} style={{ position: 'relative' }}>
                  <td style={{ paddingLeft: 16 }}>
                    <SelectCell
                      checked={selection.isSelected(p.id)}
                      onToggle={() => selection.toggle(p.id)}
                      label={`Select ${p.title || '(Untitled)'}`}
                    />
                  </td>
                  <td style={{ maxWidth: 340 }}>
                    <Link href={`/cms/posts/${p.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                      {p.title || '(Untitled)'}
                    </Link>
                    <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>/{p.slug}</div>
                  </td>
                  <td>
                    {p.category ? (
                      <span style={{ fontSize: 12, background: 'var(--surface-3)', padding: '3px 8px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 500 }}>{p.category}</span>
                    ) : <span style={{ color: 'var(--fg3)', fontSize: 12 }}>—</span>}
                  </td>
                  <td><span className={`status-pill ${p.status}`} title={statusDescription(p.status)}>{statusLabel(p.status)}</span></td>
                  <td style={{ color: 'var(--fg3)', fontSize: 12 }}>
                    {/* Only trust published_at while the post is *currently* published — it can
                        hold a stale timestamp from an earlier publish after an unpublish/reschedule,
                        which would otherwise show a misleading date next to a non-"published" pill. */}
                    {p.status === 'published' && p.published_at
                      ? new Date(p.published_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
                      : new Date(p.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ position: 'relative' }}>
                    <button
                      onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4, borderRadius: 4 }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {openMenu === p.id && (
                      <div style={{ position: 'absolute', right: 12, top: 36, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)', minWidth: 140, overflow: 'hidden' }}>
                        <Link href={`/cms/posts/${p.id}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', textDecoration: 'none' }}
                          onClick={() => setOpenMenu(null)}>
                          <Edit size={14} /> Edit
                        </Link>
                        <button
                          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                          onClick={() => handleDuplicate(p)}
                          disabled={duplicating === p.id}
                        >
                          {duplicating === p.id ? <Loader2 size={14} className="spin" /> : <Copy size={14} />}
                          Duplicate
                        </button>
                        <button
                          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--ne-danger)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                          onClick={() => handleDelete(p)}
                          disabled={deleting === p.id}
                        >
                          {deleting === p.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                          Move to trash
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Showing {filtered.length} of {posts.length} posts</span>
          </div>
        </div>
      </div>
    </>
  );
}
