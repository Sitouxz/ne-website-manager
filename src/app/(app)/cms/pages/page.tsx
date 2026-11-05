'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Globe, Lock, MoreHorizontal, Edit, Trash2, Loader2, FileEdit, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmDialog';
import { firePublishNotify, computeLivePath } from '@/lib/publish-client';
import { errorMessage } from '@/lib/errors';
import { statusDescription, statusLabel } from '@/lib/content-status';
import { EmptyState } from '@/components/EmptyState';
import { useSelectedClient } from '@/components/AppShell';
import { BulkActionBar, SelectCell } from '@/components/builder/BulkActionBar';
import { copyTitle, nextCopySlug } from '@/lib/duplicate';
import { TRASH_RETENTION_DAYS, moveToTrash, restoreFromTrash } from '@/lib/trash';
import { statusChangeEvent } from '@/lib/publish-events';
import { useBulkSelection } from '@/lib/hooks/useBulkSelection';
import type { Page } from '@/lib/supabase/types';

function fmtDate(iso: string | null) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PagesPage() {
  const [pages,    setPages]    = useState<Page[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const confirm = useConfirm();
  const router = useRouter();
  const [duplicating, setDuplicating] = useState<string | null>(null);
  // Publishing a page is client_admin/ne_admin only (migration 015). RLS is
  // the real gate; this stops a plain editor firing a screenful of rejected
  // writes and seeing a screenful of unexplained failures.
  const [canPublish, setCanPublish] = useState(false);
  const { selectedClientId } = useSelectedClient();

  const fetchPages = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('pages')
      .select('*')
      .order('path', { ascending: true });
    if (selectedClientId) query = query.eq('client_id', selectedClientId);
    const { data } = await query;
    setPages((data ?? []) as Page[]);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setCanPublish(profile?.role === 'ne_admin' || profile?.role === 'client_admin');
    }

    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchPages();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchPages]);

  const selection = useBulkSelection(pages.map((page) => page.id));

  /**
   * Copies a page as a draft and opens it.
   *
   * Always a draft, and always at a new path: `pages.path` is what the live
   * site routes on, so a copy sharing the original's path would either fail
   * the unique index or start competing with a live page for the same URL.
   */
  async function handleDuplicate(page: Page) {
    setDuplicating(page.id);
    setOpenMenu(null);


    const supabase = createClient();
    const { data: created, error } = await supabase
      .from('pages')
      .insert({
        client_id: page.client_id,
        title: copyTitle(page.title),
        path: nextCopySlug(page.path, pages.map((current) => current.path)),
        content: page.content,
        content_json: page.content_json,
        seo_title: page.seo_title,
        seo_description: page.seo_description,
        og_image_url: page.og_image_url,
        // Canonical is deliberately not copied: a copy pointing its canonical
        // at the original would quietly keep the new content out of search.
        noindex: page.noindex,
        visibility: page.visibility,
        status: 'draft',
      })
      .select()
      .single();
    setDuplicating(null);

    if (error) {
      toast.error(errorMessage(error, { entity: 'page', action: 'save' }));
      return;
    }
    toast.success(`Duplicated "${page.title || '(Untitled)'}" as a draft.`);
    router.push(`/cms/pages/${created.id}`);
  }

  /**
   * Publishes or unpublishes every selected page.
   *
   * A page with no content is skipped rather than published: unlike a post,
   * a page is usually reached from the site menu, so an empty one is a dead
   * end a visitor arrives at deliberately. Unpublishing skips the check —
   * taking something down is never blocked by it being incomplete.
   *
   * Only pages that are both published AND public are announced as live
   * changes, matching how the single delete decides whether to notify: a
   * private page was never visible, so nothing on the website changed.
   */
  async function bulkSetStatus(target: 'published' | 'draft') {
    const chosen = pages.filter((page) => selection.selectedVisibleIds.includes(page.id));
    if (chosen.length === 0) return;

    const skipped: string[] = [];
    const eligible = target === 'published'
      ? chosen.filter((page) => {
          const usable = page.content.replace(/<[^>]*>/g, '').trim() !== '';
          if (!usable) skipped.push(page.title || page.path || '(Untitled)');
          return usable;
        })
      : chosen;

    if (eligible.length === 0) {
      toast.error(`Nothing could be published — ${skipped.join(', ')} ${skipped.length === 1 ? 'has' : 'have'} no content yet.`);
      return;
    }

    setBulkBusy(true);
    const supabase = createClient();
    const results = await Promise.all(eligible.map((page) => supabase
      .from('pages')
      .update({ status: target })
      .eq('id', page.id)));

    const succeeded = eligible.filter((_, i) => !results[i].error);
    const failed = eligible.length - succeeded.length;

    // As with posts: only announce a takedown for a page that was actually
    // live. A private or draft page was never visible, so nothing changed.
    for (const page of succeeded) {
      // A page must be public as well as published to have ever been live.
      if (!page.client_id || page.visibility !== 'public') continue;
      const event = statusChangeEvent(page.status === 'published', target === 'published');
      if (!event) continue;

      firePublishNotify({
        clientId: page.client_id,
        event,
        entityType: 'page',
        entityId: page.id,
        slug: page.path,
        path: computeLivePath('page', { path: page.path }),
      });
    }

    setPages((prev) => prev.map((page) => (
      succeeded.some((x) => x.id === page.id) ? { ...page, status: target } : page
    )));
    selection.clear();
    setBulkBusy(false);

    const verb = target === 'published' ? 'published' : 'moved to draft';
    const parts = [`${succeeded.length} ${succeeded.length === 1 ? 'page' : 'pages'} ${verb}`];
    if (skipped.length > 0) parts.push(`${skipped.length} skipped as empty: ${skipped.join(', ')}`);
    if (failed > 0) parts.push(`${failed} failed`);

    if (failed > 0 || skipped.length > 0) toast.warning(parts.join('. ') + '.');
    else toast.success(parts[0] + '.');
  }

  async function bulkDelete() {
    const chosen = pages.filter((page) => selection.selectedVisibleIds.includes(page.id));
    if (chosen.length === 0) return;
    const liveCount = chosen.filter((page) => page.status === 'published').length;

    const ok = await confirm({
      title: `Move ${chosen.length} ${chosen.length === 1 ? 'page' : 'pages'} to the trash?`,
      body: `You can restore them from the trash for ${TRASH_RETENTION_DAYS} days.`,
      consequences: liveCount > 0
        ? [
            `${liveCount} of them ${liveCount === 1 ? 'is' : 'are'} published, so ${liveCount === 1 ? 'it' : 'they'} will disappear from your website.`,
            'Any link to them, in your menu or from Google, will lead to a "page not found" error.',
          ]
        : ['None of them are published, so nothing on your website will change.'],
      confirmLabel: 'Move to trash',
    });
    if (!ok) return;

    setBulkBusy(true);
    const supabase = createClient();
    const results = await Promise.all(chosen.map((page) => moveToTrash(supabase, 'page', page.id)));
    const deleted = chosen.filter((_, i) => !results[i].error);
    const firstError = results.find((r) => r.error)?.error;
    const failed = chosen.length - deleted.length;

    for (const page of deleted) {
      if (page.status !== 'published' || !page.client_id) continue;
      firePublishNotify({
        clientId: page.client_id,
        event: 'content.deleted',
        entityType: 'page',
        entityId: page.id,
        slug: page.path,
        path: computeLivePath('page', { path: page.path }),
      });
    }

    setPages((prev) => prev.filter((page) => !deleted.some((d) => d.id === page.id)));
    selection.clear();
    setBulkBusy(false);

    if (failed > 0) toast.warning(`${deleted.length} moved to the trash, ${failed} could not be. ${firstError ?? ''}`.trim());
    else toast.success(`${deleted.length} ${deleted.length === 1 ? 'page' : 'pages'} moved to the trash.`);
  }

  async function handleDelete(page: Page) {
    const title = page.title || page.path || '(Untitled)';
    const isLive = page.status === 'published' && page.visibility === 'public';

    const ok = await confirm({
      title: `Move "${title}" to the trash?`,
      body: `You can restore it from the trash for ${TRASH_RETENTION_DAYS} days.`,
      consequences: isLive
        ? [
            `This page is live at ${page.path}, so it will disappear from your website.`,
            'Any menu link or button pointing to it will lead to a "page not found" error.',
          ]
        : ['This page is not published, so nothing on your website will change.'],
      confirmLabel: 'Move to trash',
    });
    if (!ok) return;

    setDeleting(page.id);
    const supabase = createClient();
    const { trashId, error } = await moveToTrash(supabase, 'page', page.id);
    setDeleting(null);
    setOpenMenu(null);

    if (error) {
      toast.error(error);
      return;
    }
    // See the matching comment in the posts list — deleting live content used
    // to leave it on the client's website.
    if (isLive && page.client_id) {
      firePublishNotify({
        clientId: page.client_id,
        event: 'content.deleted',
        entityType: 'page',
        entityId: page.id,
        slug: page.path,
        path: computeLivePath('page', { path: page.path }),
      });
    }

    setPages((prev) => prev.filter((p) => p.id !== page.id));
    toast.success(`"${title}" moved to the trash.`, trashId ? {
      action: { label: 'Undo', onClick: () => { void undoTrash(trashId, page, isLive); } },
    } : undefined);
  }

  async function undoTrash(trashId: string, page: Page, wasLive: boolean) {
    const { row, error } = await restoreFromTrash(createClient(), trashId, 'page');
    if (error || !row) {
      toast.error(error ?? 'Could not restore the page.');
      return;
    }
    setPages((prev) => [row as unknown as Page, ...prev]);
    if (wasLive && page.client_id) {
      firePublishNotify({
        clientId: page.client_id,
        event: 'content.published',
        entityType: 'page',
        entityId: page.id,
        slug: page.path,
        path: computeLivePath('page', { path: page.path }),
      });
    }
    toast.success(`"${page.title || page.path || '(Untitled)'}" restored.`);
  }

  const publicCount = pages.filter((page) => page.status === 'published' && page.visibility === 'public').length;

  return (
    <>
      <Topbar title="Pages" subtitle={`${pages.length} CMS-managed pages`} />
      <div className="page-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <p style={{ fontSize: 13.5, color: 'var(--fg3)', margin: 0 }}>
              These records are exposed through the public pages API when published and public.
            </p>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ne-blue)', background: 'var(--ne-blue-bg)', border: '1px solid var(--ne-blue-muted)', borderRadius: 99, padding: '6px 12px' }}>
              {publicCount} public
            </div>
          </div>
          <Link href="/cms/pages/new" className="btn-ne">
            <Plus size={15} /> New Page
          </Link>
        </div>

        <div className="panel">
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
              </>
            )}
          </BulkActionBar>

          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40, paddingLeft: 16 }}>
                    <SelectCell
                      checked={selection.allVisibleSelected}
                      onToggle={selection.toggleAllVisible}
                      label={selection.allVisibleSelected ? 'Clear selection' : 'Select all pages'}
                    />
                  </th>
                  <th>Page Title</th>
                  <th>URL Path</th>
                  <th>Status</th>
                  <th>Visibility</th>
                  <th>Last Updated</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="table-placeholder">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Loader2 size={16} className="spin" /> Loading pages...
                      </div>
                    </td>
                  </tr>
                ) : pages.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <EmptyState
                        icon={FileEdit}
                        title="No pages yet"
                        body="Pages are the fixed parts of your website, like About or Contact. Add one here and choose where it lives."
                        actionLabel="Create your first page"
                        actionHref="/cms/pages/new"
                      />
                    </td>
                  </tr>
                ) : pages.map((page) => (
                  <tr key={page.id} style={{ position: 'relative' }}>
                    <td style={{ paddingLeft: 16 }}>
                      <SelectCell
                        checked={selection.isSelected(page.id)}
                        onToggle={() => selection.toggle(page.id)}
                        label={`Select ${page.title || '(Untitled)'}`}
                      />
                    </td>
                    <td>
                      <Link href={`/cms/pages/${page.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                        {page.title || '(Untitled)'}
                      </Link>
                    </td>
                    <td>
                      <code style={{ fontSize: 12, background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4, color: 'var(--fg2)' }}>{page.path}</code>
                    </td>
                    <td><span className={`status-pill ${page.status}`} title={statusDescription(page.status)}>{statusLabel(page.status)}</span></td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--fg3)' }}>
                        {page.visibility === 'public' ? <Globe size={13} /> : <Lock size={13} />}
                        {page.visibility}
                      </span>
                    </td>
                    <td style={{ color: 'var(--fg3)', fontSize: 12 }}>{fmtDate(page.updated_at)}</td>
                    <td style={{ position: 'relative' }}>
                      <button
                        onClick={() => setOpenMenu(openMenu === page.id ? null : page.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4, borderRadius: 4 }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenu === page.id && (
                        <div style={{ position: 'absolute', right: 12, top: 36, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)', minWidth: 140, overflow: 'hidden' }}>
                          <Link href={`/cms/pages/${page.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', textDecoration: 'none' }}
                            onClick={() => setOpenMenu(null)}>
                            <Edit size={14} /> Edit
                          </Link>
                          <button
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                            onClick={() => handleDuplicate(page)}
                            disabled={duplicating === page.id}
                          >
                            {duplicating === page.id ? <Loader2 size={14} className="spin" /> : <Copy size={14} />}
                            Duplicate
                          </button>
                          <button
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--ne-danger)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                            onClick={() => handleDelete(page)}
                            disabled={deleting === page.id}
                          >
                            {deleting === page.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
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
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Showing {pages.length} pages</span>
          </div>
        </div>
      </div>
    </>
  );
}
