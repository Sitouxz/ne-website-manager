'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Trash2, Loader2, X, Pencil, Save, ArrowRight, AlertTriangle, FileText, FileEdit,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import type { Redirect } from '@/lib/supabase/types';

/**
 * SEO Manager — Task 5.3. Two independent sections on one page (matching
 * the brief's single-file listing, `src/app/(app)/seo/page.tsx`):
 *
 *  1. Redirects CRUD (`redirects` table, migration 011_seo.sql) — add/edit/
 *     delete, each write checking the Supabase response's `error` before
 *     touching local state. This is the exact lesson Task 5.1's own review
 *     fixed after-the-fact (Finding 2: remove/toggle-visible/reorder in
 *     `cms/navigation/page.tsx` originally applied their optimistic
 *     local-state update unconditionally, letting the UI silently drift
 *     from the DB on a failed write) — applied here from the start rather
 *     than repeating that bug.
 *  2. Content SEO audit — read-only: lists every published post/page
 *     missing `seo_title` and/or `seo_description`, linking to that
 *     record's real editor (`/cms/posts/{id}` / `/cms/pages/{id}`) rather
 *     than duplicating SEO-field editing on this page.
 */

interface AuditItem {
  id: string;
  type: 'post' | 'page';
  title: string;
  href: string;
  missingTitle: boolean;
  missingDescription: boolean;
}

interface RedirectFormState {
  fromPath: string;
  toPath: string;
  permanent: boolean;
}

const EMPTY_FORM: RedirectFormState = { fromPath: '', toPath: '', permanent: true };

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 };
const errorBoxStyle: React.CSSProperties = { padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 };

export default function SeoManagerPage() {
  const { selectedClientId } = useSelectedClient();

  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<RedirectFormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RedirectFormState>(EMPTY_FORM);
  const [editError, setEditError] = useState('');

  const [busyId, setBusyId] = useState<string | null>(null);
  // Surfaces failures from edit/delete writes — see file header re: Task
  // 5.1's Finding 2. Never update `redirects` state after a write whose
  // `error` is non-null.
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    if (!selectedClientId) { setLoading(false); return; }
    setLoading(true);
    setLoadError('');
    const supabase = createClient();

    const [
      { data: redirectRows, error: redirectsErr },
      { data: postRows, error: postsErr },
      { data: pageRows, error: pagesErr },
    ] = await Promise.all([
      supabase.from('redirects').select('*').eq('client_id', selectedClientId).order('from_path', { ascending: true }),
      supabase.from('posts').select('id, title, seo_title, seo_description').eq('client_id', selectedClientId).eq('status', 'published'),
      supabase.from('pages').select('id, title, seo_title, seo_description').eq('client_id', selectedClientId).eq('status', 'published'),
    ]);

    if (redirectsErr) setLoadError(redirectsErr.message);
    else if (postsErr) setLoadError(postsErr.message);
    else if (pagesErr) setLoadError(pagesErr.message);

    setRedirects((redirectRows ?? []) as Redirect[]);

    type SeoRow = { id: string; title: string; seo_title: string | null; seo_description: string | null };
    const missing = (row: SeoRow) => !row.seo_title?.trim() || !row.seo_description?.trim();

    const postAudit: AuditItem[] = ((postRows ?? []) as SeoRow[])
      .filter(missing)
      .map((row) => ({
        id: row.id, type: 'post', title: row.title || '(Untitled)', href: `/cms/posts/${row.id}`,
        missingTitle: !row.seo_title?.trim(), missingDescription: !row.seo_description?.trim(),
      }));
    const pageAudit: AuditItem[] = ((pageRows ?? []) as SeoRow[])
      .filter(missing)
      .map((row) => ({
        id: row.id, type: 'page', title: row.title || '(Untitled)', href: `/cms/pages/${row.id}`,
        missingTitle: !row.seo_title?.trim(), missingDescription: !row.seo_description?.trim(),
      }));

    setAudit([...pageAudit, ...postAudit]);
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function resetAddForm() {
    setAddForm(EMPTY_FORM);
    setAddError('');
    setShowAdd(false);
  }

  async function handleAdd() {
    if (!selectedClientId) return;
    const fromPath = addForm.fromPath.trim();
    const toPath = addForm.toPath.trim();
    if (!fromPath.startsWith('/')) { setAddError('"From path" must start with /.'); return; }
    if (!toPath) { setAddError('"To path" is required.'); return; }

    setAdding(true);
    setAddError('');
    const supabase = createClient();
    const { error } = await supabase.from('redirects').insert({
      client_id: selectedClientId,
      from_path: fromPath,
      to_path: toPath,
      permanent: addForm.permanent,
    });
    setAdding(false);

    if (error) { setAddError(error.message); return; }
    resetAddForm();
    load();
  }

  function startEdit(r: Redirect) {
    setEditingId(r.id);
    setEditForm({ fromPath: r.from_path, toPath: r.to_path, permanent: r.permanent });
    setEditError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setEditError('');
  }

  async function handleSaveEdit(id: string) {
    const fromPath = editForm.fromPath.trim();
    const toPath = editForm.toPath.trim();
    if (!fromPath.startsWith('/')) { setEditError('"From path" must start with /.'); return; }
    if (!toPath) { setEditError('"To path" is required.'); return; }

    setBusyId(id);
    setEditError('');
    const supabase = createClient();
    const { error } = await supabase
      .from('redirects')
      .update({ from_path: fromPath, to_path: toPath, permanent: editForm.permanent })
      .eq('id', id);
    setBusyId(null);

    // Only reflect the edit locally once the write is confirmed to have
    // succeeded — a failed update must leave the displayed row unchanged,
    // not silently show the (unpersisted) edited values.
    if (error) { setEditError(error.message); return; }
    setRedirects((prev) => prev.map((r) => (r.id === id ? { ...r, from_path: fromPath, to_path: toPath, permanent: editForm.permanent } : r)));
    cancelEdit();
  }

  async function handleDelete(r: Redirect) {
    if (!window.confirm(`Delete the redirect from "${r.from_path}"? This cannot be undone.`)) return;

    setBusyId(r.id);
    setActionError('');
    const supabase = createClient();
    const { error } = await supabase.from('redirects').delete().eq('id', r.id);
    setBusyId(null);

    if (error) {
      setActionError(`Failed to delete "${r.from_path}": ${error.message}`);
      return;
    }
    setRedirects((prev) => prev.filter((x) => x.id !== r.id));
    if (editingId === r.id) cancelEdit();
  }

  return (
    <>
      <Topbar title="SEO Manager" subtitle="Redirects and content SEO audit" />
      <div className="page-body">
        {!selectedClientId ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 32, color: 'var(--fg3)', fontSize: 13.5 }}>
            Select a client in the sidebar first.
          </div>
        ) : (
          <>
            {loadError && <div style={errorBoxStyle}>{loadError}</div>}
            {actionError && <div style={errorBoxStyle}>{actionError}</div>}

            {/* ---------------- Redirects ---------------- */}
            <section style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>Redirects</div>
                <button className="btn-ne" onClick={() => setShowAdd((v) => !v)}>
                  <Plus size={14} /> Add Redirect
                </button>
              </div>

              {showAdd && (
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 20, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {addError && <div style={{ ...errorBoxStyle, marginBottom: 0 }}>{addError}</div>}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <label style={labelStyle}>From path</label>
                      <input
                        value={addForm.fromPath}
                        onChange={(e) => setAddForm({ ...addForm, fromPath: e.target.value })}
                        placeholder="/old-page"
                        style={{ ...inputStyle, fontFamily: 'monospace' }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <label style={labelStyle}>To path</label>
                      <input
                        value={addForm.toPath}
                        onChange={(e) => setAddForm({ ...addForm, toPath: e.target.value })}
                        placeholder="/new-page"
                        style={{ ...inputStyle, fontFamily: 'monospace' }}
                      />
                    </div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg2)' }}>
                    <input
                      type="checkbox"
                      checked={addForm.permanent}
                      onChange={(e) => setAddForm({ ...addForm, permanent: e.target.checked })}
                    />
                    Permanent (301) &mdash; uncheck for a temporary (302) redirect
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-ne" onClick={handleAdd} disabled={adding}>
                      {adding ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Plus size={14} />}
                      Add
                    </button>
                    <button className="btn-outline-ne" onClick={resetAddForm}>
                      <X size={13} /> Cancel
                    </button>
                  </div>
                </div>
              )}

              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                {loading ? (
                  <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading...
                    </div>
                  </div>
                ) : redirects.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>
                    No redirects yet. Add your first one above.
                  </div>
                ) : (
                  redirects.map((r, i) => {
                    const isEditing = editingId === r.id;
                    const isBusy = busyId === r.id;
                    return (
                      <div key={r.id} style={{ padding: '14px 20px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {editError && <div style={{ ...errorBoxStyle, marginBottom: 0 }}>{editError}</div>}
                            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                              <input
                                value={editForm.fromPath}
                                onChange={(e) => setEditForm({ ...editForm, fromPath: e.target.value })}
                                style={{ ...inputStyle, flex: 1, minWidth: 160, fontFamily: 'monospace' }}
                              />
                              <input
                                value={editForm.toPath}
                                onChange={(e) => setEditForm({ ...editForm, toPath: e.target.value })}
                                style={{ ...inputStyle, flex: 1, minWidth: 160, fontFamily: 'monospace' }}
                              />
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--fg2)' }}>
                              <input
                                type="checkbox"
                                checked={editForm.permanent}
                                onChange={(e) => setEditForm({ ...editForm, permanent: e.target.checked })}
                              />
                              Permanent (301)
                            </label>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button className="btn-ne" onClick={() => handleSaveEdit(r.id)} disabled={isBusy}>
                                {isBusy ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
                                Save
                              </button>
                              <button className="btn-outline-ne" onClick={cancelEdit}>
                                <X size={13} /> Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontFamily: 'monospace', flexWrap: 'wrap' }}>
                              <code style={{ background: 'var(--surface-2)', padding: '3px 8px', borderRadius: 4, color: 'var(--fg1)' }}>{r.from_path}</code>
                              <ArrowRight size={13} color="var(--fg3)" />
                              <code style={{ background: 'var(--surface-2)', padding: '3px 8px', borderRadius: 4, color: 'var(--fg1)' }}>{r.to_path}</code>
                              <span style={{ fontSize: 11, background: r.permanent ? 'var(--surface-3)' : 'var(--ne-blue-bg)', color: r.permanent ? 'var(--fg2)' : 'var(--ne-blue)', padding: '2px 7px', borderRadius: 99, fontWeight: 600, fontFamily: 'inherit' }}>
                                {r.permanent ? '301 Permanent' : '302 Temporary'}
                              </span>
                            </div>
                            <button
                              onClick={() => startEdit(r)}
                              disabled={isBusy}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 6, flexShrink: 0 }}
                              aria-label={`Edit redirect from ${r.from_path}`}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => handleDelete(r)}
                              disabled={isBusy}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6, flexShrink: 0 }}
                              aria-label={`Delete redirect from ${r.from_path}`}
                            >
                              {isBusy ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* ---------------- Content SEO audit ---------------- */}
            <section>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Content SEO Audit</div>
              <p style={{ fontSize: 13, color: 'var(--fg3)', margin: '0 0 14px' }}>
                Published posts and pages missing an SEO title or description. Click through to fix them in their own editor.
              </p>

              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                {loading ? (
                  <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading...
                    </div>
                  </div>
                ) : audit.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>
                    Nothing to flag &mdash; every published post and page has both an SEO title and description.
                  </div>
                ) : (
                  audit.map((item, i) => (
                    <Link
                      key={`${item.type}-${item.id}`}
                      href={item.href}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
                        borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                        textDecoration: 'none', color: 'inherit',
                      }}
                    >
                      {item.type === 'post' ? <FileText size={14} color="var(--fg3)" /> : <FileEdit size={14} color="var(--fg3)" />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg1)' }}>{item.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 2, textTransform: 'capitalize' }}>{item.type}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {item.missingTitle && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ne-danger)', fontWeight: 600, background: '#FEF2F2', padding: '3px 8px', borderRadius: 99 }}>
                            <AlertTriangle size={11} /> Missing title
                          </span>
                        )}
                        {item.missingDescription && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--ne-danger)', fontWeight: 600, background: '#FEF2F2', padding: '3px 8px', borderRadius: 99 }}>
                            <AlertTriangle size={11} /> Missing description
                          </span>
                        )}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
