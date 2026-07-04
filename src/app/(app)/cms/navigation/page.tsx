'use client';

import Topbar from '@/components/Topbar';
import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Loader2, Eye, EyeOff, X, Link2, Boxes, Type,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import type { MenuItem, MenuItemLinkType, Collection } from '@/lib/supabase/types';

/**
 * Public navigation tree editor — Task 5.1. Manages `menu_items` rows
 * where `location = 'public'` for the selected client (`cms_sidebar`-
 * location items are out of scope per the plan's reconciliation note —
 * this app's own sidebar is defined statically in `Sidebar.tsx`, not
 * data-driven from `menu_items`).
 *
 * Nesting is deliberately capped at two levels (top-level items, each with
 * an optional flat list of children) rather than exposing arbitrary-depth
 * nesting in the UI. `menu_items.parent_id` self-references arbitrarily
 * deep, but a real site's primary nav realistically needs "Services" with
 * a dropdown of sub-links, not four levels of flyouts — matching this
 * codebase's established "simpler than drag-and-drop" precedent (Task 4.2's
 * schema builder) of not building more UI than the actual use case needs.
 * A child item's "parent" selector therefore only ever offers top-level
 * items, and a child cannot itself be chosen as a parent.
 *
 * `link_type: 'custom'` vs `'url'` — the schema defines no functional
 * difference between them (both use the same `url` column); this UI treats
 * them as equivalent, offering both only so an existing row already tagged
 * `'custom'` displays with a sensible label rather than forcing every
 * external/internal link into a literal `'url'` bucket. New items default
 * to `'url'`.
 *
 * Add/remove/reorder/visibility-toggle all write straight to Supabase and
 * refetch, rather than a batch "Save" button — this list is a small set of
 * real rows being mutated directly (closer to the pages/posts list's
 * immediate-delete pattern than to the schema builder's draft-then-save
 * pattern), so there's no local "unsaved changes" concept to protect.
 */

const LINK_TYPES: { value: MenuItemLinkType; label: string; Icon: React.ElementType }[] = [
  { value: 'collection', label: 'Collection', Icon: Boxes },
  { value: 'url',        label: 'URL',        Icon: Link2 },
  { value: 'custom',     label: 'Custom',      Icon: Type },
];

interface AddFormState {
  label: string;
  linkType: MenuItemLinkType;
  collectionSlug: string;
  url: string;
  parentId: string; // '' = top level
}

const EMPTY_FORM: AddFormState = { label: '', linkType: 'url', collectionSlug: '', url: '', parentId: '' };

export default function NavigationPage() {
  const { selectedClientId } = useSelectedClient();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [collections, setCollections] = useState<Pick<Collection, 'id' | 'slug' | 'name'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Surfaces failures from remove/toggle-visible/reorder writes — these three
  // handlers previously applied their optimistic local-state update
  // unconditionally, regardless of whether the Supabase write actually
  // succeeded, letting the editor UI drift from the real DB (and therefore
  // the live public nav) on a failed mutation. See Task 5.1 review Finding 2.
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    if (!selectedClientId) { setLoading(false); return; }
    setLoading(true);
    setError('');
    const supabase = createClient();
    const [{ data: menuRows, error: menuErr }, { data: collRows }] = await Promise.all([
      supabase
        .from('menu_items')
        .select('*')
        .eq('client_id', selectedClientId)
        .eq('location', 'public')
        .order('sort_order', { ascending: true }),
      supabase
        .from('collections')
        .select('id, slug, name')
        .eq('client_id', selectedClientId)
        .eq('storage', 'generic'),
    ]);
    if (menuErr) setError(menuErr.message);
    setItems((menuRows ?? []) as MenuItem[]);
    setCollections((collRows ?? []) as Pick<Collection, 'id' | 'slug' | 'name'>[]);
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const topLevel = items.filter((i) => !i.parent_id).sort((a, b) => a.sort_order - b.sort_order);
  const childrenOf = (parentId: string) =>
    items.filter((i) => i.parent_id === parentId).sort((a, b) => a.sort_order - b.sort_order);

  function resetAddForm() {
    setForm(EMPTY_FORM);
    setAddError('');
    setShowAdd(false);
  }

  async function handleAdd() {
    if (!selectedClientId) return;
    const label = form.label.trim();
    if (!label) { setAddError('Label is required.'); return; }
    if (form.linkType === 'collection' && !form.collectionSlug) { setAddError('Pick a collection.'); return; }
    if (form.linkType !== 'collection' && !form.url.trim()) { setAddError('URL is required.'); return; }

    const siblings = form.parentId ? childrenOf(form.parentId) : topLevel;
    const nextSortOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.sort_order)) + 1 : 0;

    setAdding(true);
    setAddError('');
    const supabase = createClient();
    const { error: insertError } = await supabase.from('menu_items').insert({
      client_id: selectedClientId,
      location: 'public',
      label,
      link_type: form.linkType,
      collection_slug: form.linkType === 'collection' ? form.collectionSlug : null,
      url: form.linkType === 'collection' ? null : form.url.trim(),
      parent_id: form.parentId || null,
      sort_order: nextSortOrder,
      is_visible: true,
    });
    setAdding(false);

    if (insertError) { setAddError(insertError.message); return; }
    resetAddForm();
    load();
  }

  async function handleRemove(item: MenuItem) {
    const childCount = childrenOf(item.id).length;
    const msg = childCount > 0
      ? `Delete "${item.label}" and its ${childCount} sub-item(s)? This cannot be undone.`
      : `Delete "${item.label}"? This cannot be undone.`;
    if (!window.confirm(msg)) return;

    setBusyId(item.id);
    setActionError('');
    const supabase = createClient();
    const { error: deleteError } = await supabase.from('menu_items').delete().eq('id', item.id);
    setBusyId(null);

    if (deleteError) {
      setActionError(`Failed to delete "${item.label}": ${deleteError.message}`);
      return;
    }
    load();
  }

  async function handleToggleVisible(item: MenuItem) {
    setBusyId(item.id);
    setActionError('');
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from('menu_items')
      .update({ is_visible: !item.is_visible })
      .eq('id', item.id);
    setBusyId(null);

    if (updateError) {
      setActionError(`Failed to update "${item.label}": ${updateError.message}`);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_visible: !i.is_visible } : i)));
  }

  async function handleMove(item: MenuItem, dir: -1 | 1) {
    const siblings = item.parent_id ? childrenOf(item.parent_id) : topLevel;
    const index = siblings.findIndex((s) => s.id === item.id);
    const targetIndex = index + dir;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;
    const other = siblings[targetIndex];

    setBusyId(item.id);
    setActionError('');
    const supabase = createClient();
    const [{ error: itemError }, { error: otherError }] = await Promise.all([
      supabase.from('menu_items').update({ sort_order: other.sort_order }).eq('id', item.id),
      supabase.from('menu_items').update({ sort_order: item.sort_order }).eq('id', other.id),
    ]);
    setBusyId(null);

    if (itemError || otherError) {
      setActionError(`Failed to reorder "${item.label}": ${(itemError ?? otherError)!.message}`);
      // Re-fetch so local state matches the DB — one of the two writes may
      // have partially succeeded even though the pair failed as a whole.
      load();
      return;
    }
    setItems((prev) => prev.map((i) => {
      if (i.id === item.id) return { ...i, sort_order: other.sort_order };
      if (i.id === other.id) return { ...i, sort_order: item.sort_order };
      return i;
    }));
  }

  function describeLink(item: MenuItem): string {
    if (item.link_type === 'collection') return `Collection: /${item.collection_slug ?? ''}`;
    return item.url ?? '';
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--fg1)',
  };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 };

  function renderRow(item: MenuItem, opts: { indent: boolean }) {
    const siblings = item.parent_id ? childrenOf(item.parent_id) : topLevel;
    const index = siblings.findIndex((s) => s.id === item.id);
    const isBusy = busyId === item.id;
    return (
      <div
        key={item.id}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
          paddingLeft: opts.indent ? 48 : 20,
          borderTop: '1px solid var(--border)',
          opacity: item.is_visible ? 1 : 0.55,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <button
            onClick={() => handleMove(item, -1)}
            disabled={index === 0 || isBusy}
            style={{ background: 'none', border: 'none', cursor: index === 0 ? 'default' : 'pointer', color: index === 0 ? 'var(--border)' : 'var(--fg3)', padding: 2 }}
            aria-label="Move up"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => handleMove(item, 1)}
            disabled={index === siblings.length - 1 || isBusy}
            style={{ background: 'none', border: 'none', cursor: index === siblings.length - 1 ? 'default' : 'pointer', color: index === siblings.length - 1 ? 'var(--border)' : 'var(--fg3)', padding: 2 }}
            aria-label="Move down"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg1)' }}>{item.label}</span>
            <span style={{ fontSize: 11, background: 'var(--surface-3)', padding: '2px 7px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 500 }}>
              {LINK_TYPES.find((t) => t.value === item.link_type)?.label ?? item.link_type}
            </span>
            {!item.is_visible && (
              <span style={{ fontSize: 11, color: 'var(--fg3)', fontWeight: 600 }}>Hidden</span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2, fontFamily: 'monospace' }}>{describeLink(item)}</div>
        </div>

        <button
          onClick={() => handleToggleVisible(item)}
          disabled={isBusy}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 6, flexShrink: 0 }}
          aria-label={item.is_visible ? `Hide ${item.label}` : `Show ${item.label}`}
        >
          {item.is_visible ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button
          onClick={() => handleRemove(item)}
          disabled={isBusy}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6, flexShrink: 0 }}
          aria-label={`Remove ${item.label}`}
        >
          {isBusy ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={14} />}
        </button>
      </div>
    );
  }

  return (
    <>
      <Topbar title="Navigation" subtitle="Public site menu" />
      <div className="page-body">

        {!selectedClientId ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 32, color: 'var(--fg3)', fontSize: 13.5 }}>
            Select a client in the sidebar first.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
              <button className="btn-ne" onClick={() => setShowAdd((v) => !v)}>
                <Plus size={14} /> Add Item
              </button>
            </div>

            {error && (
              <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}

            {actionError && (
              <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
                {actionError}
              </div>
            )}

            {showAdd && (
              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 20, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {addError && (
                  <div style={{ padding: '8px 12px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 12.5 }}>
                    {addError}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label style={labelStyle}>Label</label>
                    <input
                      value={form.label}
                      onChange={(e) => setForm({ ...form, label: e.target.value })}
                      placeholder="About Us"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label style={labelStyle}>Nest under</label>
                    <select
                      value={form.parentId}
                      onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                      style={{ ...inputStyle, background: 'var(--surface)' }}
                    >
                      <option value="">— Top level —</option>
                      {topLevel.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Link type</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {LINK_TYPES.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        onClick={() => setForm({ ...form, linkType: value })}
                        style={{
                          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          padding: '9px 12px', borderRadius: 'var(--r-sm)', fontSize: 12.5, fontWeight: 600,
                          cursor: 'pointer',
                          border: form.linkType === value ? '1.5px solid var(--ne-blue)' : '1px solid var(--border)',
                          color: form.linkType === value ? 'var(--ne-blue)' : 'var(--fg2)',
                          background: form.linkType === value ? 'var(--surface)' : 'transparent',
                        }}
                      >
                        <Icon size={13} /> {label}
                      </button>
                    ))}
                  </div>
                </div>

                {form.linkType === 'collection' ? (
                  <div>
                    <label style={labelStyle}>Collection</label>
                    <select
                      value={form.collectionSlug}
                      onChange={(e) => setForm({ ...form, collectionSlug: e.target.value })}
                      style={{ ...inputStyle, background: 'var(--surface)' }}
                    >
                      <option value="">— Select a collection —</option>
                      {collections.map((c) => <option key={c.id} value={c.slug}>{c.name} (/{c.slug})</option>)}
                    </select>
                    {collections.length === 0 && (
                      <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 6 }}>
                        This client has no generic collections yet — create one under All Collections first.
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label style={labelStyle}>URL</label>
                    <input
                      value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                      placeholder="/about or https://example.com"
                      style={{ ...inputStyle, fontFamily: 'monospace' }}
                    />
                  </div>
                )}

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
              ) : topLevel.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>
                  No navigation items yet. Add your first one above.
                </div>
              ) : (
                topLevel.map((item) => (
                  <div key={item.id}>
                    {renderRow(item, { indent: false })}
                    {childrenOf(item.id).map((child) => renderRow(child, { indent: true }))}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
